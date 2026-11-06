-- L'IDENTIFIANT DU FICHIER D'UNE DÉCLARATION D'E-REPORTING (ligne 28.5, étape e6b ; décision du cabinet du 18/10/2026,
-- E6-Q8 : « l'identifiant tiré au téléchargement, puis donné à la base »). Le récit : HISTORIQUE.md, « 06/11/2026 — LE
-- FICHIER D'UNE DÉCLARATION D'E-REPORTING, À L'ÉCRAN (E6B, E6-Q8, E5B2) (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai :
-- supabase/essais/identifiantDuFichierEreporting.sql ; le drapeau : `IDENTIFIANT_DU_FICHIER_EXPORTE`
-- (src/lib/declarationsEreporting.ts).
--
-- POURQUOI. Le fichier FRR (lib/fluxEreporting.ts, étape e6) se dépose sur la plateforme AVANT que le cabinet n'inscrive
-- ici la déclaration : son identifiant de transmission (TT-1 ; annexe 7, G1.104, G8.05) ne peut donc pas être celui de la
-- ligne que la base créera ensuite. L'application le tire au téléchargement (un UUID) et le donne à la déclaration quand
-- le cabinet l'inscrit : la base sait alors quel fichier porte la période, et le fichier d'une déclaration active se
-- retire tel quel de son contenu figé.
--
-- CE QU'ELLE POSE :
--   1. `declarations_ereporting.identifiant_fichier`, un UUID nul par défaut — une période déclarée sans fichier tiré
--      d'ici, et toutes celles d'avant (aucune en production : rien n'est dû avant les factures du 01/09/2027) —, unique
--      dans le dossier (`declarations_ereporting_un_fichier`). Il ne change jamais : la garde d'hier
--      (`garder_declaration_ereporting`) refuse toute mise à jour d'une autre colonne que l'état, celle-ci comprise ;
--   2. `declarer_ereporting_hors_application` reçoit un DIXIÈME paramètre, `p_identifiant_fichier`, nul par défaut — un
--      appel d'hier, à neuf paramètres, fait ce qu'il faisait — et l'écrit sur la déclaration ; son refus neuf vient au
--      rang 20, après la note et avant le contenu : un identifiant qui est déjà celui d'une déclaration du dossier
--      (22023). Les rangs d'hier 20 à 30 deviennent 21 à 31 ; « la période n'est pas finie » reste le DERNIER, et le refus
--      neuf se joue donc en production dès aujourd'hui. Le reste du corps est celui de l'export, au caractère près.
--
-- CE QU'ELLE NE CHANGE PAS : la table des sources, les policies (le client ne lit toujours rien), les gardes, l'index de
-- la déclaration active, la porte de la restauration (le super-administrateur insère la ligne entière, colonne comprise,
-- sous la même clé unique).
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` retiendra) : la fonction d'hier, à neuf paramètres
-- (`drop function`), aussitôt recréée à dix — AUCUNE donnée. Elle ne s'applique donc pas par l'outil : le cabinet la COLLE
-- dans l'éditeur SQL, dans une transaction, avec sa ligne d'historique, puis la session vérifie l'empreinte de
-- l'historique et rejoue les trois contrôles de l'export. Une barre oblique inverse (`\d`, dans une expression régulière
-- d'hier), aucun échappement `\u`, aucun retour chariot. Son retour arrière, donné à part (`supabase/preparees/retour/`),
-- retire la colonne : destructif, il se refuse tant qu'une déclaration porte un identifiant, à accorder, et à coller.

-- ══ La colonne ══════════
alter table public.declarations_ereporting
  add column identifiant_fichier uuid,
  add constraint declarations_ereporting_un_fichier unique (dossier_id, identifiant_fichier);

comment on column public.declarations_ereporting.identifiant_fichier is
  'L''identifiant du fichier FRR déposé pour cette déclaration (TT-1), tiré par l''application au téléchargement puis donné à la déclaration (E6-Q8) ; nul quand la période a été déclarée sans fichier tiré d''ici. Unique dans le dossier ; il ne change jamais (garder_declaration_ereporting).';

-- ══ La fonction : un dixième paramètre, nul par défaut ══════════
-- La signature change : l'ancienne fonction est RETIRÉE (aucune donnée) et la nouvelle reprend ses droits et son
-- commentaire. Un appel d'hier, à neuf paramètres nommés, reçoit le défaut et fait ce qu'il faisait.
drop function public.declarer_ereporting_hors_application(uuid, text, date, date, uuid, uuid, text, jsonb, text);

create function public.declarer_ereporting_hors_application(
  p_dossier_id uuid,
  p_objet text,
  p_debut date,
  p_fin date,
  p_regime_id uuid,
  p_remplace_id uuid,
  p_plateforme text,
  p_contenu jsonb,
  p_note text,
  p_identifiant_fichier uuid default null
)
returns public.declarations_ereporting
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_note text := case when btrim(p_note) = '' then null else p_note end;
  v_regime public.regimes_ereporting;
  v_suivant public.regimes_ereporting;
  v_frequence text;
  v_periode record;
  v_autre public.declarations_ereporting;
  v_active public.declarations_ereporting;
  v_remplacee public.declarations_ereporting;
  v_cle text;
  v_liste text;
  v_operations jsonb;
  v_lisible boolean;
  v_date date;
  v_ids uuid[];
  v_pieces uuid[];
  v_nombre integer;
  v_inconnue boolean;
  v_declaration public.declarations_ereporting;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ : un dossier qui n'existe pas se refuse comme un dossier interdit.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(public.cle_ereporting(p_dossier_id));
  -- 2. L'objet : les ventes et les achats sont des transactions, les paiements à part.
  if p_objet is null or p_objet not in ('ventes', 'achats', 'paiements') then
    raise exception 'Une déclaration d''e-reporting porte sur les ventes, les achats ou les paiements du dossier.' using errcode = '22023';
  end if;
  -- 3.
  if p_debut is null or p_fin is null then
    raise exception 'Les deux bornes de la période sont à renseigner.' using errcode = '22023';
  end if;
  -- 4 à 8. Le régime sous lequel la période se juge : du dossier, actif, le régime en vigueur à son premier jour — celui
  -- qui le couvre et qu'aucun autre ne suit avant —, et aucun régime qui déclare autrement ne commence avant sa fin : une
  -- période à cheval sur deux régimes ne se déclare pas ici, les sources publiques ne disant pas comment (hypothèse E5-Q1,
  -- étape e5a). Deux régimes égaux qui se suivent ne sont pas un changement.
  select * into v_regime from public.regimes_ereporting r where r.id = p_regime_id and r.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Régime introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_regime.retire_le is not null then
    raise exception 'Ce régime est retiré : une période se déclare sous le régime confirmé qui la couvre.' using errcode = '22023';
  end if;
  if v_regime.depuis > p_debut then
    raise exception 'Ce régime ne vaut qu''à partir du % : il ne couvre pas le début de la période.',
      to_char(v_regime.depuis, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select * into v_suivant from public.regimes_ereporting r
   where r.dossier_id = p_dossier_id and r.retire_le is null and r.depuis > v_regime.depuis and r.depuis <= p_debut
   order by r.depuis desc limit 1;
  if found then
    raise exception 'Le régime en vigueur le % est celui confirmé à partir du % : relisez.',
      to_char(p_debut, 'DD/MM/YYYY'), to_char(v_suivant.depuis, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select * into v_suivant from public.regimes_ereporting r
   where r.dossier_id = p_dossier_id and r.retire_le is null and r.depuis > p_debut and r.depuis <= p_fin
     and (r.statut_tva, r.article_exoneration, r.tva_periodicite, r.tva_sur_debits, r.frequence_transactions, r.frequence_paiements)
         is distinct from (v_regime.statut_tva, v_regime.article_exoneration, v_regime.tva_periodicite, v_regime.tva_sur_debits,
                           v_regime.frequence_transactions, v_regime.frequence_paiements)
   order by r.depuis limit 1;
  if found then
    raise exception 'Le régime du dossier change dans la période, le % : une période à cheval sur deux régimes ne se déclare pas ici, les sources publiques ne disant pas comment. À trancher par le cabinet.',
      to_char(v_suivant.depuis, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  -- 9. La fréquence de l'objet sous ce régime : aucune pour des paiements sur option pour les débits
  -- (BOI-TVA-DECLA-20-30-60, § 30).
  v_frequence := case when p_objet = 'paiements' then v_regime.frequence_paiements else v_regime.frequence_transactions end;
  if v_frequence is null then
    raise exception 'Sous ce régime, sur option pour la TVA sur les débits, le dossier n''a pas de données de paiement à déclarer.'
      using errcode = '22023';
  end if;
  -- 10. Les bornes : la période de cette fréquence qui contient le premier jour (e1).
  select * into v_periode from public.periode_ereporting(p_debut, v_frequence);
  if v_periode.debut is distinct from p_debut or v_periode.fin is distinct from p_fin then
    raise exception 'Du % au % n''est pas une période de ses déclarations : sous ce régime, elles se font %.',
      to_char(p_debut, 'DD/MM/YYYY'), to_char(p_fin, 'DD/MM/YYYY'),
      case v_frequence when 'decade' then 'par décade' when 'mois' then 'chaque mois' else 'tous les deux mois' end
      using errcode = '22023';
  end if;
  -- 11. L'obligation d'une PME ou d'une micro-entreprise vise les factures du 01/09/2027 et après.
  if p_fin < date '2027-09-01' then
    raise exception 'La période finit le %, avant le 1er septembre 2027 : l''e-reporting d''une PME ou d''une micro-entreprise commence avec les factures de ce jour.',
      to_char(p_fin, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  -- 12. Une déclaration active d'autres bornes qui chevauche la période — faite sous un régime d'une autre fréquence,
  -- retiré depuis : une même opération ne se déclare pas deux fois.
  select * into v_autre from public.declarations_ereporting d
   where d.dossier_id = p_dossier_id and d.objet = p_objet and d.etat = 'declaree'
     and (d.periode_debut, d.periode_fin) is distinct from (p_debut, p_fin)
     and d.periode_debut <= p_fin and p_debut <= d.periode_fin
   order by d.periode_debut, d.id limit 1;
  if found then
    raise exception 'La période chevauche celle d''une déclaration active, du % au % : une même opération ne se déclare pas deux fois. À trancher par le cabinet.',
      to_char(v_autre.periode_debut, 'DD/MM/YYYY'), to_char(v_autre.periode_fin, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  -- 13 à 16. L'initiale ou la rectificative.
  select * into v_active from public.declarations_ereporting d
   where d.dossier_id = p_dossier_id and d.objet = p_objet and d.periode_debut = p_debut and d.periode_fin = p_fin
     and d.etat = 'declaree';
  if p_remplace_id is null then
    if found then
      raise exception 'Une déclaration de cette période est déjà active, faite sur « % » : une correction se fait par une déclaration rectificative, qui la remplace entière.',
        v_active.plateforme using errcode = '22023';
    end if;
  else
    select * into v_remplacee from public.declarations_ereporting d where d.id = p_remplace_id and d.dossier_id = p_dossier_id;
    if not found then
      raise exception 'Déclaration introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    if v_remplacee.objet <> p_objet or v_remplacee.periode_debut <> p_debut or v_remplacee.periode_fin <> p_fin then
      raise exception 'Une rectificative remplace la déclaration de la même période et du même objet : celle-ci en déclare une autre.'
        using errcode = '22023';
    end if;
    if v_remplacee.etat <> 'declaree' then
      raise exception 'Cette déclaration est déjà remplacée : une rectificative remplace la déclaration active de la période.'
        using errcode = '22023';
    end if;
  end if;
  -- 17 et 18. La plateforme, telle que le cabinet la nomme.
  if p_plateforme is null or btrim(p_plateforme) = '' then
    raise exception 'La plateforme sur laquelle la période a été déclarée est à nommer.' using errcode = '22023';
  end if;
  if length(p_plateforme) > 200 then
    raise exception 'Le nom de la plateforme dépasse 200 caractères.' using errcode = '22023';
  end if;
  -- 19.
  if length(v_note) > 2000 then
    raise exception 'La note de la déclaration dépasse 2 000 caractères.' using errcode = '22023';
  end if;
  -- 20. Le fichier déposé, quand la déclaration en a un (E6-Q8) : son identifiant, tiré au téléchargement, ne sert qu'à
  -- UNE déclaration du dossier — une transmission se reconnaît à son identifiant (annexe 7, G1.104, G8.05) ; une
  -- rectificative se dépose avec un fichier neuf.
  if p_identifiant_fichier is not null and exists (
       select 1 from public.declarations_ereporting d
        where d.dossier_id = p_dossier_id and d.identifiant_fichier = p_identifiant_fichier) then
    raise exception 'Ce fichier est déjà celui d''une autre déclaration du dossier : chaque dépôt a son fichier, et une rectificative se dépose avec un fichier neuf.'
      using errcode = '22023';
  end if;
  -- 21 à 23. Le contenu : un objet JSON d'un mégaoctet au plus, qui dit l'objet, les bornes et le rôle du déclarant.
  if p_contenu is null or jsonb_typeof(p_contenu) <> 'object' then
    raise exception 'Le contenu déclaré est à joindre : celui que l''application a calculé pour la période.' using errcode = '22023';
  end if;
  if octet_length(p_contenu::text) > 1048576 then
    raise exception 'Le contenu déclaré dépasse un mégaoctet (1 048 576 octets).' using errcode = '22023';
  end if;
  if p_contenu ->> 'objet' is distinct from p_objet or p_contenu ->> 'debut' is distinct from to_char(p_debut, 'YYYY-MM-DD')
     or p_contenu ->> 'fin' is distinct from to_char(p_fin, 'YYYY-MM-DD')
     or p_contenu ->> 'role' is distinct from (case when p_objet = 'achats' then 'BY' else 'SE' end) then
    raise exception 'Le contenu ne porte pas sur cet objet et cette période : relisez.' using errcode = '22023';
  end if;
  -- 24. Les opérations : un tableau — `achats`, `transactions` ou `paiements` —, chacune un objet qui porte sa date civile
  -- (AAAA-MM-JJ) et ses sources : la fiche et sa pièce d'un achat, les factures d'un agrégat de ventes, les encaissements
  -- d'un agrégat de paiements, chacune un identifiant.
  v_cle := case p_objet when 'achats' then 'achats' when 'ventes' then 'transactions' else 'paiements' end;
  v_liste := case p_objet when 'ventes' then 'factures' when 'paiements' then 'encaissements' end;
  v_operations := p_contenu -> v_cle;
  v_lisible := jsonb_typeof(v_operations) is not distinct from 'array';
  if v_lisible then
    v_lisible := not exists (
      select 1 from jsonb_array_elements(v_operations) e(v)
       where jsonb_typeof(e.v) is distinct from 'object'
          or jsonb_typeof(e.v -> 'date') is distinct from 'string'
          or not coalesce((e.v ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' and pg_input_is_valid(e.v ->> 'date', 'date'), false)
          or case when p_objet = 'achats'
                  then jsonb_typeof(e.v -> 'ficheId') is distinct from 'string' or jsonb_typeof(e.v -> 'pieceId') is distinct from 'string'
                       or not coalesce(pg_input_is_valid(e.v ->> 'ficheId', 'uuid') and pg_input_is_valid(e.v ->> 'pieceId', 'uuid'), false)
                  else jsonb_typeof(e.v -> v_liste) is distinct from 'array'
                       or exists (select 1
                                    from jsonb_array_elements(case when jsonb_typeof(e.v -> v_liste) = 'array' then e.v -> v_liste
                                                                   else '[]'::jsonb end) s(x)
                                   where jsonb_typeof(s.x) is distinct from 'string'
                                      or not coalesce(pg_input_is_valid(s.x #>> '{}', 'uuid'), false))
             end);
  end if;
  if not v_lisible then
    raise exception 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.' using errcode = '22023';
  end if;
  -- 25. La première date d'opération hors des bornes.
  select min((e.v ->> 'date')::date) into v_date from jsonb_array_elements(v_operations) e(v)
   where (e.v ->> 'date')::date not between p_debut and p_fin;
  if v_date is not null then
    raise exception 'Une opération du contenu est datée du %, hors de la période : relisez.', to_char(v_date, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  -- Les sources, dans l'ordre du contenu, et pour un achat la pièce de sa fiche.
  if p_objet = 'achats' then
    select coalesce(array_agg((e.v ->> 'ficheId')::uuid order by e.o), '{}'), coalesce(array_agg((e.v ->> 'pieceId')::uuid order by e.o), '{}')
      into v_ids, v_pieces
      from jsonb_array_elements(v_operations) with ordinality e(v, o);
  else
    select coalesce(array_agg((s.x #>> '{}')::uuid order by e.o, s.p), '{}') into v_ids
      from jsonb_array_elements(v_operations) with ordinality e(v, o),
           jsonb_array_elements(e.v -> v_liste) with ordinality s(x, p);
    v_pieces := '{}';
  end if;
  v_nombre := cardinality(v_ids);
  -- 26 à 28. Jamais à blanc ; une opération une fois ; le nombre que le contenu annonce.
  if v_nombre = 0 then
    raise exception 'Une période sans opération ne se déclare pas : aucune transmission n''est attendue.' using errcode = '22023';
  end if;
  if v_nombre <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'Une même source figure deux fois dans le contenu : une opération ne se déclare qu''une fois.' using errcode = '22023';
  end if;
  if (p_contenu -> 'nombreOperations') is distinct from to_jsonb(v_nombre) then
    raise exception 'Le contenu n''annonce pas le nombre de ses opérations (%) : relisez.', v_nombre using errcode = '22023';
  end if;
  -- 29. Des sources de ce dossier : la fiche d'une pièce — celle que l'achat nomme — dans ce dossier, la pièce verrouillée ;
  -- une facture validée ; un encaissement.
  if p_objet = 'achats' then
    perform 1 from public.pieces p where p.dossier_id = p_dossier_id and p.id = any (v_pieces) order by p.id for share;
    v_inconnue := exists (
      select 1 from unnest(v_ids, v_pieces) as s(fiche, piece)
       where not exists (select 1 from public.pieces_hors_de_france f join public.pieces p on p.id = f.piece_id
                          where f.id = s.fiche and f.dossier_id = p_dossier_id and f.piece_id = s.piece
                            and p.dossier_id = p_dossier_id));
  elsif p_objet = 'ventes' then
    v_inconnue := exists (
      select 1 from unnest(v_ids) x
       where not exists (select 1 from public.factures_emises f
                          where f.id = x and f.dossier_id = p_dossier_id and f.statut = 'validee'));
  else
    v_inconnue := exists (
      select 1 from unnest(v_ids) x
       where not exists (select 1 from public.encaissements_factures e where e.id = x and e.dossier_id = p_dossier_id));
  end if;
  if v_inconnue then
    raise exception 'Une source du contenu n''est pas % de ce dossier : relisez.',
      case p_objet when 'achats' then 'la fiche « fournisseur établi hors de France » d''une pièce' when 'ventes' then 'une facture validée'
                   else 'un encaissement' end
      using errcode = '22023';
  end if;
  -- 30. Une opération que porte déjà une autre déclaration active — la même pièce pour un achat, quelle que soit la
  -- version de sa fiche — : la période qui la porte se rectifie d'abord. La déclaration que la rectificative remplace ne
  -- compte pas.
  select d.* into v_autre
    from public.declarations_ereporting d
    join public.declarations_ereporting_sources s on s.declaration_id = d.id
   where d.dossier_id = p_dossier_id and d.etat = 'declaree' and d.id is distinct from p_remplace_id
     and case when p_objet = 'achats'
              then s.genre = 'fiche' and exists (select 1 from public.pieces_hors_de_france f
                                                  where f.id = s.source_id and f.piece_id = any (v_pieces))
              else s.genre = case p_objet when 'ventes' then 'facture' else 'encaissement' end and s.source_id = any (v_ids)
         end
   order by d.periode_debut, d.id limit 1;
  if found then
    raise exception 'Une opération du contenu est déjà déclarée, dans la période du % au % : la période qui la porte se rectifie d''abord.',
      to_char(v_autre.periode_debut, 'DD/MM/YYYY'), to_char(v_autre.periode_fin, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  -- 31. La période finie, le jour lu à Paris (G7.43 : la fin d'une période est avant le jour du contrôle).
  if p_fin >= v_aujourd_hui then
    raise exception 'La période n''est pas finie : elle se déclare à partir du %.', to_char(p_fin + 1, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;

  -- D'un seul tenant : la déclaration remplacée passe « remplacée » AVANT que la rectificative ne s'insère — l'index des
  -- déclarations actives n'en admet qu'une —, puis les sources.
  if p_remplace_id is not null then
    update public.declarations_ereporting set etat = 'remplacee' where id = p_remplace_id;
  end if;
  insert into public.declarations_ereporting (
    dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, remplace_id, canal, plateforme, contenu,
    empreinte, nb_operations, etat, note, cree_par, identifiant_fichier
  ) values (
    p_dossier_id, p_objet, p_debut, p_fin, p_regime_id, case when p_remplace_id is null then 'IN' else 'RE' end, p_remplace_id,
    'manuel', p_plateforme, p_contenu, encode(sha256(convert_to(p_contenu::text, 'UTF8')), 'hex'), v_nombre, 'declaree',
    v_note, auth.uid(), p_identifiant_fichier
  )
  returning * into v_declaration;
  insert into public.declarations_ereporting_sources (declaration_id, dossier_id, genre, source_id)
  select v_declaration.id, p_dossier_id, case p_objet when 'achats' then 'fiche' when 'ventes' then 'facture' else 'encaissement' end, x
    from unnest(v_ids) x;
  return v_declaration;
end
$$;

revoke execute on function public.declarer_ereporting_hors_application(uuid, text, date, date, uuid, uuid, text, jsonb, text, uuid)
  from public, anon;
grant execute on function public.declarer_ereporting_hors_application(uuid, text, date, date, uuid, uuid, text, jsonb, text, uuid)
  to authenticated;
comment on function public.declarer_ereporting_hors_application(uuid, text, date, date, uuid, uuid, text, jsonb, text, uuid) is
  'Garde une déclaration d''e-reporting faite hors de l''application, initiale ou rectificative, et l''identifiant du fichier déposé quand elle en a un (E6-Q8), sous verrou, après les refus dits dans les migrations declarations_ereporting et identifiant_du_fichier_ereporting.';
