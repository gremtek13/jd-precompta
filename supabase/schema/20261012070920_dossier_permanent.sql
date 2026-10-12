-- LA RÉVISION DES COMPTES, ÉTAPE R7 : LE DOSSIER PERMANENT (ligne 41 de la feuille de route ; conception du 09/10/2026,
-- HISTORIQUE.md, « LA RÉVISION DES COMPTES : LA CONCEPTION », § 1.2, 3.3 et 3.7).
--
-- « L'expert-comptable constitue un dossier de travail contenant la documentation de ses travaux » (NP 2300, § 16, arrêté
-- du 01/09/2016). Ce dossier « comprend » « les informations utiles sur l'entité pour la mission en cours et les missions
-- ultérieures », et « peut contenir » « un exemplaire de la lettre de mission », « des documents juridiques de l'entité
-- et contrats importants », « la description de l'entité et de son activité », « la présentation de l'organisation
-- comptable » (A9, une liste donnée « sans préjudice d'autres éléments »). La mission elle-même tient dans « un contrat
-- écrit définissant leur mission », qui « peut prendre la forme d'une lettre de mission » (décret n° 2012-432, art. 151,
-- version en vigueur depuis le 01/01/2023). Textes relus sur Légifrance le 11/10/2026. Ce qui vaut pour plusieurs
-- exercices se range, comme dans la pratique des cabinets, dans un dossier PERMANENT (conception, § 1.2) : c'est lui.
--
-- CE QUE CETTE MIGRATION POSE, sur le patron des étapes R1, R4 et R5 — des affirmations datées, signées, écrites par des
-- fonctions seules, lues par le cabinet seul :
--   - `dossier_permanent` : une ENTRÉE du dossier permanent d'un dossier — sa nature (la lettre de mission, la
--     description de l'entité, son organisation comptable, ses statuts, un bail, un contrat d'emprunt, un autre contrat,
--     autre chose), un titre, un texte, AU PLUS UNE pièce ou un document du dossier qu'elle cite par son empreinte, et sa
--     période de validité. Elle ne se modifie pas : une nouvelle version la REMPLACE (chaîne `remplace_id`), et la
--     version courante se RETIRE (qui, quand) quand l'entrée n'a plus sa place au dossier permanent — une fois, et une
--     entrée retirée ne se remplace plus : une autre se consigne. Rien ne se supprime, sauf avec le dossier.
-- Ce qui n'est pas stocké, et se DÉDUIT (src/lib/dossierPermanent.ts) : la version courante d'une entrée, les entrées qui
-- valent pour un exercice, ce qu'une citation prouve encore (l'empreinte du jour face à celle qui a été citée).
--
-- CE QUI A ÉTÉ CHOISI, ET POURQUOI :
--   - le dossier permanent n'appartient à AUCUN exercice : il vaut pour ceux de sa période de validité (conception,
--     § 3.7). Il s'écrit donc à tout moment — la lettre de mission précède les travaux —, et la règle « seul un exercice
--     terminé se révise » (Q11) ne le concerne pas ;
--   - le RETRAIT, que la chaîne seule ne sait pas dire : une entrée consignée par erreur, ou devenue sans objet, sort du
--     dossier permanent sans rien effacer (la forme de la fiche « hors de France », étape e2). Une entrée retirée ne se
--     remplace plus, et c'est un écart à cette forme : la chaîne n'a pas de clé (une même nature se consigne plusieurs
--     fois — deux baux, deux contrats), rien n'oblige à reprendre la même, et un onglet qui n'aurait pas vu le retrait
--     ne le défait pas ;
--   - la CITATION, un objet jsonb (`{"piece_id": …}` ou `{"document_id": …}`) plutôt que deux paramètres : l'étape R8 y
--     admettra `fichier_id` en remplaçant la fonction, sans changer sa signature ; la colonne `fichier_id` est là, sans
--     clé, et la garde la refuse jusque-là (la forme de `revision_preuves`, étape R1) ;
--   - le message d'une source citée dit la NATURE de l'entrée qui la cite, jamais son titre : un texte saisi ne part pas
--     dans un message d'erreur, qu'un journal peut garder.
--
-- LES QUESTIONS AU CABINET N'ONT PAS ENCORE DE RÉPONSE (09/10/2026). Les recommandations de la conception sont prises comme
-- HYPOTHÈSES, chacune rangée pour qu'une autre réponse se reprenne par `create or replace function`, sans rien retirer :
--   - Q2 : tout membre du cabinet affecté au dossier consigne et retire (`admin_du_dossier`, refus 1) ;
--   - Q8 : une pièce ou un document CITÉ par le dossier permanent — même par une entrée remplacée ou retirée depuis :
--     l'historique garde ses preuves — ne se supprime plus et ne change plus de dossier, sauf avec le dossier entier.
--     C'est la règle de l'étape R1, et elle vit au même endroit : `garder_source_citee`, remplacée ici, dit la révision
--     d'un solde d'abord, mot pour mot comme avant, puis le dossier permanent ; une autre réponse se reprendra en la
--     remplaçant, une fois pour les deux ;
--   - Q7 : la suppression d'un dossier emporte son dossier permanent (clé du dossier en cascade) ;
--   - Q9 : un document du CABINET, que le client ne voit pas, attend l'étape R8 ; d'ici là, le texte de l'entrée, que le
--     client ne lit pas, porte ce que le cabinet garde pour lui ;
--   - Q6 : ce qu'une finalisation (étape R9) figera du dossier permanent, qui vaut pour plusieurs exercices, se décidera
--     avec elle ; aucune place n'est gardée dans l'ordre des refus.
-- Q5 (la mission) n'est pas tranchée : rien ici ne présume de la mission que la lettre de mission décrit.
--
-- Données mesurées le 11/10/2026 (comptes seulement) : 125 migrations en production, aucun exercice validé. Aucun écran
-- n'appelle les fonctions avant la phase C de l'étape : tout ce qui suit est latent.

-- ══ Les entrées ══════════
-- Une entrée du dossier permanent. La nature la range (les éléments de A9) ; le titre la nomme (500 caractères) ; le texte
-- dit ce que le cabinet consigne (8 000 caractères) — rien, quand la pièce ou le document cité suffit, mais une entrée dit
-- toujours quelque chose. La citation désigne une pièce OU un document du dossier, sans clé étrangère (hypothèse Q8, la
-- forme de `revision_preuves`) : la garde vérifie à l'insertion que la source est du dossier et la verrouille, et
-- `garder_source_citee` refuse ensuite de la supprimer ou de la déplacer. L'empreinte est le SHA-256 de la source,
-- RECOPIÉ au moment de la citation : c'est la preuve, pas le nom du fichier ; nulle quand la source n'en porte pas. La
-- validité est une période, bornes comprises : un début nul vaut « depuis toujours », une fin nulle « sans terme ».
-- L'auteur et l'auteur du retrait sont des repères d'audit sans clé étrangère, comme `exercices_valides.valide_par` :
-- retirer le compte d'un membre parti ne doit pas effacer qui a consigné.
create table public.dossier_permanent (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  nature text not null
    constraint dossier_permanent_nature check (nature in ('lettre_mission', 'description', 'organisation_comptable', 'statuts',
                                                          'bail', 'contrat_emprunt', 'contrat', 'autre')),
  -- Des blancs seuls (espaces, tabulations, retours à la ligne) ne sont ni un titre ni un texte.
  titre text not null
    constraint dossier_permanent_titre check (btrim(titre, E' \t\n\r') <> '' and length(titre) <= 500),
  texte text
    constraint dossier_permanent_texte check (btrim(texte, E' \t\n\r') <> '' and length(texte) <= 8000),
  piece_id uuid,
  document_id uuid,
  fichier_id uuid,
  empreinte text
    constraint dossier_permanent_empreinte check (empreinte ~ '^[0-9a-f]{64}$'),
  valable_du date
    constraint dossier_permanent_valable_du check (valable_du between date '1900-01-01' and date '2100-12-31'),
  valable_jusqu_au date
    constraint dossier_permanent_valable_jusqu_au check (valable_jusqu_au between date '1900-01-01' and date '2100-12-31'),
  remplace_id uuid references public.dossier_permanent (id),
  auteur uuid not null,
  cree_le timestamptz not null default now(),
  retire_le timestamptz,
  retire_par uuid,
  constraint dossier_permanent_une_citation check (num_nonnulls(piece_id, document_id, fichier_id) <= 1),
  constraint dossier_permanent_dit_quelque_chose check (texte is not null or num_nonnulls(piece_id, document_id, fichier_id) = 1),
  constraint dossier_permanent_empreinte_citee check (empreinte is null or num_nonnulls(piece_id, document_id, fichier_id) = 1),
  constraint dossier_permanent_validite check (valable_jusqu_au >= valable_du),
  constraint dossier_permanent_retrait check ((retire_le is null) = (retire_par is null)),
  constraint dossier_permanent_une_suite unique (remplace_id)
);
create index dossier_permanent_dossier on public.dossier_permanent (dossier_id);
-- `garder_source_citee` cherche, à chaque suppression d'une pièce ou d'un document, s'il est cité.
create index dossier_permanent_piece on public.dossier_permanent (piece_id);
create index dossier_permanent_document on public.dossier_permanent (document_id);

-- ══ La garde ══════════
-- Une entrée ne se modifie pas — sauf son RETRAIT, une fois, et seulement la version courante — et ne se supprime pas,
-- sauf avec son dossier entier, que la ligne ne voit déjà plus pendant la cascade (le critère des gardes des étapes R1 à
-- R5). Une entrée en remplace une de son dossier qui n'est pas retirée : avec le retrait réservé à la version courante,
-- une entrée retirée n'a jamais de suite. Le retrait et la nouvelle version d'une même entrée se suivent sous le verrou de
-- la révision du dossier, même en direct (la porte de la restauration, le propriétaire) : la garde le prend avant de
-- lire, et voit ce que l'autre a écrit. Elle le prend par sa clé, celle de `cle_revision`, que l'appelant d'une garde
-- n'exécute pas ; la ligne remplacée, elle, ne se verrouille pas ici — la RLS refuse le verrou d'une ligne qu'aucune
-- policy de mise à jour n'ouvre. Une entrée cite une pièce ou un document de son dossier — un fichier du cabinet attend
-- l'étape R8 —, VERROUILLÉ en partage jusqu'à la fin de la transaction, comme le ferait une clé étrangère, et plus fort
-- qu'elle : une suppression ou un changement de dossier concurrent attend, puis voit la citation (`garder_source_citee`).
-- Ce que les fonctions vérifient de plus — la version COURANTE, les formes — ne se rejoue pas ici : une restauration
-- réinsère l'histoire telle qu'elle a été écrite, retraits compris. Aux droits de l'appelant, et avant la RLS : qui ne
-- voit pas une entrée est refusé sans apprendre si elle existe.
create function public.garder_dossier_permanent() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une entrée du dossier permanent ne se supprime pas : elle se remplace, ou se retire, et l''historique reste.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['retire_le', 'retire_par']) is distinct from (to_jsonb(old) - array['retire_le', 'retire_par'])
       or old.retire_le is not null or new.retire_le is null then
      raise exception 'Une entrée du dossier permanent ne se modifie pas : elle se remplace par une nouvelle, ou se retire, une fois.'
        using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('jd.revision_des_comptes:' || old.dossier_id::text, 0));
    if exists (select 1 from public.dossier_permanent s where s.remplace_id = old.id) then
      raise exception 'Seule la version courante d''une entrée du dossier permanent se retire.' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.remplace_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('jd.revision_des_comptes:' || new.dossier_id::text, 0));
    if not exists (select 1 from public.dossier_permanent e where e.id = new.remplace_id and e.dossier_id = new.dossier_id) then
      raise exception 'Une entrée du dossier permanent en remplace une de son dossier.' using errcode = '23514';
    end if;
    if exists (select 1 from public.dossier_permanent e where e.id = new.remplace_id and e.retire_le is not null) then
      raise exception 'Une entrée retirée du dossier permanent ne se remplace plus.' using errcode = '23514';
    end if;
  end if;
  if new.fichier_id is not null then
    raise exception 'Un fichier du cabinet ne se cite pas encore : une entrée cite une pièce ou un document du dossier.'
      using errcode = '23514';
  end if;
  if new.piece_id is not null then
    perform 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id for share;
    if not found then
      raise exception 'Une entrée du dossier permanent cite une pièce de son dossier.' using errcode = '23514';
    end if;
  end if;
  if new.document_id is not null then
    perform 1 from public.documents_divers d where d.id = new.document_id and d.dossier_id = new.dossier_id for share;
    if not found then
      raise exception 'Une entrée du dossier permanent cite un document de son dossier.' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger dossier_permanent_gardes
  before insert or update or delete on public.dossier_permanent
  for each row execute function public.garder_dossier_permanent();

-- ══ Une source citée reste où elle est (HYPOTHÈSE Q8) : le dossier permanent aussi ══════════
-- La règle de l'étape R1, étendue aux citations du dossier permanent : une pièce ou un document cité — par une décision
-- sur un solde ou par une entrée du dossier permanent, même remplacée ou retirée depuis : l'historique garde ses preuves —
-- ne se supprime plus et ne change plus de dossier, sauf avec son dossier entier, dont la cascade emporte ensemble les
-- sources et la révision. La révision d'un solde se dit d'abord, sous ses mots d'hier (src/lib/revision.ts les redit avant
-- le clic) ; le dossier permanent ensuite, par la NATURE de l'entrée qui cite — la première dans l'ordre de A9 —, jamais
-- par son titre. Les deux déclencheurs de l'étape R1 restent : seule la fonction change. DEFINER pour voir la révision
-- quelle que soit la RLS de qui supprime ; elle ne rend que la ligne, ou le refus.
create or replace function public.garder_source_citee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_annee integer;
  v_compte text;
  v_nature text;
begin
  if not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
     or tg_op = 'UPDATE' and new.dossier_id is not distinct from old.dossier_id then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if tg_table_name = 'pieces' then
    select j.annee, j.compte into v_annee, v_compte
      from public.revision_preuves p join public.revision_justifications j on j.id = p.justification_id
     where p.piece_id = old.id
     order by j.annee, j.compte
     limit 1;
  else
    select j.annee, j.compte into v_annee, v_compte
      from public.revision_preuves p join public.revision_justifications j on j.id = p.justification_id
     where p.document_id = old.id
     order by j.annee, j.compte
     limit 1;
  end if;
  if found then
    raise exception '% par la révision du solde du compte % (exercice %) : %, sauf avec son dossier.',
      case when tg_table_name = 'pieces' then 'Cette pièce est citée' else 'Ce document est cité' end,
      v_compte, v_annee,
      case when tg_op = 'DELETE' then case when tg_table_name = 'pieces' then 'elle ne se supprime plus' else 'il ne se supprime plus' end
           else case when tg_table_name = 'pieces' then 'elle ne change plus de dossier' else 'il ne change plus de dossier' end
      end
      using errcode = '23514';
  end if;
  if tg_table_name = 'pieces' then
    select e.nature into v_nature
      from public.dossier_permanent e
     where e.piece_id = old.id
     order by array_position(array['lettre_mission', 'description', 'organisation_comptable', 'statuts', 'bail',
                                   'contrat_emprunt', 'contrat', 'autre'], e.nature)
     limit 1;
  else
    select e.nature into v_nature
      from public.dossier_permanent e
     where e.document_id = old.id
     order by array_position(array['lettre_mission', 'description', 'organisation_comptable', 'statuts', 'bail',
                                   'contrat_emprunt', 'contrat', 'autre'], e.nature)
     limit 1;
  end if;
  if not found then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  raise exception '% par le dossier permanent (%) : %, sauf avec son dossier.',
    case when tg_table_name = 'pieces' then 'Cette pièce est citée' else 'Ce document est cité' end,
    case v_nature when 'lettre_mission' then 'lettre de mission' when 'description' then 'description de l''entité'
                  when 'organisation_comptable' then 'organisation comptable' when 'statuts' then 'statuts'
                  when 'bail' then 'bail' when 'contrat_emprunt' then 'contrat d''emprunt' when 'contrat' then 'contrat'
                  else 'autre document' end,
    case when tg_op = 'DELETE' then case when tg_table_name = 'pieces' then 'elle ne se supprime plus' else 'il ne se supprime plus' end
         else case when tg_table_name = 'pieces' then 'elle ne change plus de dossier' else 'il ne change plus de dossier' end
    end
    using errcode = '23514';
end
$$;

-- ══ Qui lit, qui écrit ══════════
-- Le cabinet LIT le dossier permanent de ses dossiers et l'écrit par `consigner_au_dossier_permanent` et
-- `retirer_du_dossier_permanent`, seules à le faire depuis le navigateur : la table n'a aucune policy d'écriture
-- ordinaire. Le super-administrateur en insère pour restaurer une sauvegarde. Le client n'y voit rien : aucune policy ne
-- le nomme.
alter table public.dossier_permanent enable row level security;
create policy dossier_permanent_lecture on public.dossier_permanent
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy dossier_permanent_restauration on public.dossier_permanent
  for insert to authenticated with check (is_super_admin());

-- ══ Consigner une entrée ══════════
-- Une entrée nouvelle, ou une nouvelle version d'une entrée, sous le verrou partagé de la validation puis le verrou
-- exclusif de la révision du dossier (`cle_revision`, l'ordre des étapes R1, R4 et R5) : deux versions concurrentes d'une
-- même entrée se suivent, et la seconde voit la première (refus 8) ; la source citée reste verrouillée jusqu'à la fin.
-- Les refus, dans cet ordre — src/lib/dossierPermanent.ts les dit avant le clic, dans le même ordre et sous les mêmes
-- mots :
--   1. un appelant qui n'est pas `admin_du_dossier` du dossier annoncé, ou un dossier qui n'existe pas (42501) —
--      HYPOTHÈSE Q2 ;
--   2. une nature qui n'est pas l'une des huit ;
--   3. un titre absent, fait de blancs, ou de plus de 500 caractères ;
--   4. un texte fait de blancs, ou de plus de 8 000 caractères ;
--   5. une citation illisible : ni rien, ni un objet d'une seule clé, `piece_id` ou `document_id`, dont la valeur est un
--      identifiant ;
--   6. une entrée qui ne dit rien : ni texte, ni citation ;
--   7. une validité hors de 1900 à 2100, ou dont la fin précède le début ;
--   8. une entrée à remplacer qui n'est pas une entrée de ce dossier, qui a été remplacée depuis, ou qui est retirée ;
--   9. une pièce ou un document cité qui n'est pas de ce dossier.
-- Tous en 22023, sauf l'accès. Elle recopie l'empreinte de la source et rend l'entrée écrite, son identifiant et son
-- instant compris.
create function public.consigner_au_dossier_permanent(
  p_dossier_id uuid,
  p_nature text,
  p_titre text,
  p_texte text,
  p_citation jsonb,
  p_valable_du date,
  p_valable_jusqu_au date,
  p_remplace_id uuid
)
returns public.dossier_permanent
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Le JSON `null` ne se distingue pas d'une absence : aucune citation.
  v_citation jsonb := nullif(p_citation, 'null'::jsonb);
  v_cible public.dossier_permanent;
  v_empreinte text;
  v_entree public.dossier_permanent;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ : un dossier qui n'existe pas se refuse comme un dossier interdit.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(public.cle_revision(p_dossier_id));
  -- 2.
  if p_nature is null or p_nature not in ('lettre_mission', 'description', 'organisation_comptable', 'statuts', 'bail',
                                           'contrat_emprunt', 'contrat', 'autre') then
    raise exception 'Une entrée du dossier permanent est la lettre de mission, la description de l''entité, son organisation comptable, ses statuts, un bail, un contrat d''emprunt, un autre contrat, ou autre chose.'
      using errcode = '22023';
  end if;
  -- 3. Des blancs seuls ne sont pas un titre.
  if p_titre is null or btrim(p_titre, E' \t\n\r') = '' then
    raise exception 'Une entrée du dossier permanent porte un titre.' using errcode = '22023';
  end if;
  if length(p_titre) > 500 then
    raise exception 'Un titre tient en 500 caractères au plus.' using errcode = '22023';
  end if;
  -- 4. Un texte est facultatif ; des blancs seuls n'en sont pas un.
  if p_texte is not null and btrim(p_texte, E' \t\n\r') = '' then
    raise exception 'Un texte ne se compose pas que de blancs : le laisser vide.' using errcode = '22023';
  end if;
  if length(p_texte) > 8000 then
    raise exception 'Un texte tient en 8 000 caractères au plus.' using errcode = '22023';
  end if;
  -- 5. La citation : rien, ou une pièce ou un document désigné par son identifiant — un fichier du cabinet attend
  -- l'étape R8. Comme pour les preuves de `justifier_solde`, le type de la valeur ne se contrôle pas à part : seule une
  -- chaîne JSON s'écrit comme un uuid, et le motif refuse le reste. Le `case` ne lit les clés que d'un objet ; entre
  -- parenthèses, parce que PL/pgSQL arrêterait la condition au premier `then` qu'il rencontre.
  if v_citation is not null
     and (case when jsonb_typeof(v_citation) <> 'object' then true
               else (select count(*) from jsonb_object_keys(v_citation)) <> 1
                    or exists (select 1 from jsonb_object_keys(v_citation) k(cle) where k.cle not in ('piece_id', 'document_id'))
                    or coalesce(v_citation ->> 'piece_id', v_citation ->> 'document_id', '')
                       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          end) then
    raise exception 'La citation est illisible : une pièce ou un document du dossier, désigné par son identifiant.'
      using errcode = '22023';
  end if;
  -- 6.
  if p_texte is null and v_citation is null then
    raise exception 'Une entrée du dossier permanent dit quelque chose : un texte, ou la pièce ou le document qu''elle cite.'
      using errcode = '22023';
  end if;
  -- 7. La validité, bornes comprises : un début nul vaut « depuis toujours », une fin nulle « sans terme ».
  if p_valable_du not between date '1900-01-01' and date '2100-12-31'
     or p_valable_jusqu_au not between date '1900-01-01' and date '2100-12-31' then
    raise exception 'Une date de validité est comprise entre 1900 et 2100.' using errcode = '22023';
  end if;
  if p_valable_jusqu_au < p_valable_du then
    raise exception 'La fin de validité précède son début.' using errcode = '22023';
  end if;
  -- 8. On remplace la version COURANTE d'une entrée du dossier, et une entrée qui n'est pas retirée.
  if p_remplace_id is not null then
    select * into v_cible from public.dossier_permanent e where e.id = p_remplace_id and e.dossier_id = p_dossier_id;
    if not found then
      raise exception 'L''entrée à remplacer n''est pas une entrée du dossier permanent de ce dossier.' using errcode = '22023';
    end if;
    if exists (select 1 from public.dossier_permanent s where s.remplace_id = p_remplace_id) then
      raise exception 'Cette entrée a été remplacée depuis : relire avant de la remplacer.' using errcode = '22023';
    end if;
    if v_cible.retire_le is not null then
      raise exception 'Cette entrée est retirée : elle ne se remplace plus, une nouvelle entrée se consigne.' using errcode = '22023';
    end if;
  end if;
  -- 9. La source citée est du dossier, et reste verrouillée jusqu'à la fin ; son empreinte se recopie telle que la base la
  -- porte : un SHA-256 en hexadécimal, ou rien.
  if v_citation ->> 'piece_id' is not null then
    select p.storage_hash into v_empreinte from public.pieces p
     where p.id = (v_citation ->> 'piece_id')::uuid and p.dossier_id = p_dossier_id for share;
    if not found then
      raise exception 'La pièce ou le document cité n''est pas de ce dossier.' using errcode = '22023';
    end if;
  elsif v_citation ->> 'document_id' is not null then
    select d.storage_hash into v_empreinte from public.documents_divers d
     where d.id = (v_citation ->> 'document_id')::uuid and d.dossier_id = p_dossier_id for share;
    if not found then
      raise exception 'La pièce ou le document cité n''est pas de ce dossier.' using errcode = '22023';
    end if;
  end if;

  insert into public.dossier_permanent (
    dossier_id, nature, titre, texte, piece_id, document_id, empreinte, valable_du, valable_jusqu_au, remplace_id, auteur
  ) values (
    p_dossier_id, p_nature, p_titre, p_texte, (v_citation ->> 'piece_id')::uuid, (v_citation ->> 'document_id')::uuid,
    case when v_empreinte ~ '^[0-9a-f]{64}$' then v_empreinte end, p_valable_du, p_valable_jusqu_au, p_remplace_id,
    auth.uid()
  )
  returning * into v_entree;
  return v_entree;
end
$$;

-- ══ Retirer une entrée ══════════
-- Une entrée qui n'a plus sa place au dossier permanent — consignée par erreur, ou devenue sans objet : sa version
-- courante est marquée retirée (par qui, quand) et cesse de compter ; elle reste, ses citations aussi (Q8), et ne se
-- remplace plus. Sous les mêmes verrous que la consignation. Les refus, dans cet ordre :
--   1. l'accès (42501) — HYPOTHÈSE Q2 ;
--   2. une entrée qui n'est pas de ce dossier (P0002) ;
--   3. une entrée remplacée depuis ;
--   4. une entrée déjà retirée.
create function public.retirer_du_dossier_permanent(p_dossier_id uuid, p_entree_id uuid)
returns public.dossier_permanent
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entree public.dossier_permanent;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(public.cle_revision(p_dossier_id));
  -- 2.
  select * into v_entree from public.dossier_permanent e where e.id = p_entree_id and e.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Entrée introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  -- 3.
  if exists (select 1 from public.dossier_permanent s where s.remplace_id = p_entree_id) then
    raise exception 'Cette entrée a été remplacée depuis : relire avant de la retirer.' using errcode = '22023';
  end if;
  -- 4.
  if v_entree.retire_le is not null then
    raise exception 'Cette entrée est déjà retirée.' using errcode = '22023';
  end if;
  update public.dossier_permanent
     set retire_le = now(), retire_par = auth.uid()
   where id = p_entree_id
  returning * into v_entree;
  return v_entree;
end
$$;

-- ══ Les droits d'exécution ══════════
-- Les deux fonctions qui écrivent vérifient l'accès elles-mêmes, et un anonyme n'a rien à y faire. Les gardes ne servent
-- qu'aux déclencheurs : personne ne les appelle.
revoke execute on function public.consigner_au_dossier_permanent(uuid, text, text, text, jsonb, date, date, uuid)
  from public, anon;
grant execute on function public.consigner_au_dossier_permanent(uuid, text, text, text, jsonb, date, date, uuid)
  to authenticated;
revoke execute on function public.retirer_du_dossier_permanent(uuid, uuid) from public, anon;
grant execute on function public.retirer_du_dossier_permanent(uuid, uuid) to authenticated;
revoke execute on function public.garder_dossier_permanent() from public, anon, authenticated;
revoke execute on function public.garder_source_citee() from public, anon, authenticated;

comment on table public.dossier_permanent is
  'Le dossier permanent de la révision des comptes (ligne 41, étape R7) : lettre de mission, description de l''entité, organisation comptable, statuts, contrats, chaque entrée datée, signée, valable pour une période, citant au plus une pièce ou un document par son empreinte ; elle se remplace par une autre (remplace_id) ou se retire, une fois, et ne se modifie jamais. Écrit par consigner_au_dossier_permanent et retirer_du_dossier_permanent seules ; le client n''en voit rien.';
comment on function public.consigner_au_dossier_permanent(uuid, text, text, text, jsonb, date, date, uuid) is
  'Consigne une entrée du dossier permanent, ou une nouvelle version d''une entrée, d''un seul tenant et sous verrou, après les neuf refus dits dans la migration dossier_permanent.';
comment on function public.retirer_du_dossier_permanent(uuid, uuid) is
  'Retire la version courante d''une entrée du dossier permanent : elle reste, marquée retirée, et ne se remplace plus.';
comment on function public.garder_dossier_permanent() is
  'Une entrée du dossier permanent ne se modifie pas, sauf son retrait, une fois, et ne se supprime pas, sauf avec son dossier ; elle remplace une entrée non retirée de son dossier et cite une source de son dossier.';
comment on function public.garder_source_citee() is
  'Une pièce ou un document cité par la révision (une décision sur un solde, ou une entrée du dossier permanent) ne se supprime plus et ne change plus de dossier, sauf avec son dossier (hypothèse Q8).';
