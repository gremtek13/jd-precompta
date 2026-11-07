-- DEUX REFUS DE PLUS À LA VALIDATION D'UNE FACTURE : JJ-Q4, L'ADRESSE DU CLIENT D'UNE FACTURE À UNE ENTREPRISE OU À UN
-- ORGANISME PUBLIC (la réponse du cabinet du 07/11/2026 : « Oui, refuser à la validation »), ET A7C-Q1, LA LIGNE À 0 % D'UN
-- DOSSIER REDEVABLE SANS ARTICLE D'EXONÉRATION (la réponse du même jour : « (A) Refuser, comme recommandé »). PRÉPARÉE le
-- 07/11/2026, PAS APPLIQUÉE. Son nom, `adresse_du_client_exigee`, est celui du premier refus : la migration porte les
-- deux. Le récit : HISTORIQUE.md, « JJ-Q4 : UNE FACTURE À UNE ENTREPRISE SANS ADRESSE NE SE VALIDE PAS, ET LA LIGNE À 0 %
-- D'UN REDEVABLE (A7C-Q1) (PRÉPARÉE, PAS APPLIQUÉE) ». Le module qui les redit avant le clic : src/lib/validationDeLaFacture.ts
-- (`REFUS_ADRESSE_DU_CLIENT`, `REFUS_LIGNE_A_ZERO`, sous `ADRESSE_DU_CLIENT_EXIGEE`, le drapeau de cette migration, baissé) ;
-- son essai : supabase/essais/adresseDuClientExigee.sql ; son retour :
-- supabase/preparees/retour/20261107200100_retour_adresse_du_client_exigee.sql.
--
-- POURQUOI.
--   JJ-Q4. La relecture du jour J (06/11/2026) : une facture à une entreprise se validait sans l'adresse de son client —
--   seul l'aperçu de la transmission le disait (src/lib/factureCii.ts, « L'adresse du client manque. ») —, et une facture
--   validée ne se corrige que par un avoir. Or la facture porte « Le nom complet, le numéro d'identification mentionné au
--   premier alinéa de l'article R. 123-221 du code de commerce et l'adresse de l'assujetti et de son client » (CGI, ann. II,
--   art. 242 nonies A, I, 1°, en vigueur depuis le 1er janvier 2025, lu sur Légifrance le 07/11/2026), et, entre
--   professionnels, « le nom des parties ainsi que leur adresse » (code de commerce, art. L441-9, I). Une facture à un
--   particulier — un patient — se valide comme hier : la prestation à un particulier n'oblige pas à facturer (CGI, art. 289,
--   I), et le cabinet n'a demandé le refus que pour une entreprise ou un organisme public.
--   A7C-Q1. La base acceptait la ligne à 0 % d'un dossier redevable sans article d'exonération et l'imprimait sans mention ;
--   à la transmission, elle partait comme une exonération sous l'article du dossier — qu'il n'a pas. Une facture qui ne
--   facture pas la TVA d'une opération dit pourquoi (CGI, ann. II, art. 242 nonies A, I) ; des débours — les sommes payées
--   au nom et pour le compte du client — ne sont pas des recettes de la facture (CGI, art. 267, II, 2°) : ils n'y entrent
--   pas comme une ligne à 0 %. La réponse (B), le motif choisi par ligne, viendra avec les clients établis hors de France
--   (e7).
--
-- CE QU'ELLE POSE : une fonction de déclencheur, `garder_mentions_a_la_validation`, et son déclencheur
-- `factures_emises_figees_mentions`, AVANT la mise à jour d'une ligne de `factures_emises` qui passe à « validée ». À cette
-- validation, une FACTURE (une facture d'acompte et la finale d'un devis comprises : ce sont des factures), jugée sur ce que
-- la validation fige, dans cet ordre, en 22023 — le code des refus que la garde des factures oppose à une validation —,
-- sous des mots que le module redit au caractère près :
--   1. (rang 19, JJ-Q4) son type de client FIGÉ est « assujetti » (une entreprise établie en France) ou
--      « organisme_public », et l'adresse du client (`tiers_adresse`) est nulle ou faite des seuls blancs que `trim`
--      retire (ceux de `v_blancs` d'`enregistrer_facture`). Ce qui dit « entreprise ou organisme public » est la valeur que
--      la facture porte, celle que le formulaire envoie et que la facture électronique lit (`versEntreprise`,
--      src/lib/factureCii.ts), jamais la fiche du contact, qui vit après elle ;
--   2. (rang 20, A7C-Q1) le statut de TVA qu'elle fige est « redevable », elle ne fige aucun article d'exonération, et une
--      de ses lignes est au taux 0 — sauf sous un régime d'e7a que la TVA française ne taxe pas (`regime_international` de
--      la migration préparée `facture_internationale`, autre que « taxable_en_france » : l'autoliquidation, la prestation
--      hors de l'Union, la livraison intracommunautaire, l'exportation, le hors champ), qui imprime sa propre mention. La
--      colonne du régime se lit par `to_jsonb(new)`, qui la rend nulle tant qu'elle n'existe pas : la règle tient avec ou
--      sans `facture_internationale`, dans les deux ordres d'application. Les lignes sont en base à ce moment : la fonction
--      les remplace avant de valider. DEFINER, comme la garde, pour les lire quelle que soit la RLS de l'appelant.
--
-- CE QU'ELLE NE JUGE PAS :
--   - un AVOIR : il reprend le client, le statut de TVA et l'article de sa facture (`enregistrer_facture` les copie de la
--     facture d'origine), et il défait une facture telle qu'elle a été faite — la voie reste ouverte, même pour une
--     facture validée avant cette migration sans adresse ou avec une ligne à 0 % ;
--   - une facture déjà validée (la condition du déclencheur : l'ancienne ligne n'est pas « validée ») : rien ne change pour
--     elle, ni pour la restauration d'une sauvegarde, qui insère des factures validées sans en valider aucune ;
--   - pour l'adresse : un particulier (`non_assujetti`), un client établi hors de France (`etranger`, même une entreprise :
--     JJQ4-Q1, au cabinet), un type de client à préciser (nul) ; pour la ligne à 0 % : un dossier exonéré ou en franchise
--     (la garde exige déjà leur mention), un statut à préciser, un redevable qui a choisi son article.
--
-- SA PLACE : un déclencheur à lui, et non un bloc de plus dans la garde des factures (`garder_factures_validees`), pour ne
-- redéfinir ni la garde — que la migration préparée `facture_internationale` (20261107120000) remplace après avoir vérifié
-- son empreinte, que cette migration laisse donc intacte — ni `enregistrer_facture` (qui se colle). Les deux migrations se
-- combinent ainsi dans les deux ordres, aucune ne touchant ce que l'autre pose ou vérifie. Les déclencheurs d'un même
-- moment se suivent dans l'ordre de leurs noms : le nom de la garde, `factures_emises_figees`, est le début de celui-ci,
-- qui la suit donc immédiatement. Ses refus viennent ainsi APRÈS la légitimité de la validation (seule
-- `enregistrer_facture` valide, sous le verrou de sa série) et tous les refus de la garde — les rangs 14 à 18 de
-- src/lib/validationDeLaFacture.ts, et le bloc « E7A » quand `facture_internationale` est en base —, et AVANT ceux de la
-- source de la vente (`factures_emises_source_de_la_vente`, src/lib/sourceDeLaVente.ts) : les rangs 19 et 20.
--
-- CE QU'ELLE DÉTRUIT : rien. Aucune table, aucune colonne, aucune donnée, aucune policy touchées ; la garde de tête refuse
-- une base où elle est déjà, ou où la garde des factures n'est pas le déclencheur qu'elle suit. Elle s'applique PAR
-- L'OUTIL : son texte ne porte aucun mot de retrait. Son retour, lui, se colle.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if to_regprocedure('public.garder_mentions_a_la_validation()') is not null
     or exists (select 1 from pg_trigger t where t.tgrelid = 'public.factures_emises'::regclass
                 and t.tgname = 'factures_emises_figees_mentions') then
    raise exception 'La migration adresse_du_client_exigee est déjà en base (sa fonction ou son déclencheur) : elle ne se rejoue pas.';
  end if;
  if (select count(*) from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'factures_emises'
         and c.column_name in ('type', 'statut', 'type_client', 'tiers_adresse', 'statut_tva', 'article_exoneration')) <> 6
     or (select count(*) from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'facture_lignes'
            and c.column_name in ('facture_id', 'taux_tva')) <> 2 then
    raise exception 'La base n''a pas le type de client et les mentions figées des factures (lignes 28.5 et A7a) : cette migration les suppose.';
  end if;
  -- La garde des factures, qui établit la légitimité de la validation, est le déclencheur ligne AVANT la mise à jour que
  -- celui-ci suit dans l'ordre des noms : sans elle, ces refus viendraient avant les siens.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.factures_emises'::regclass and t.tgname = 'factures_emises_figees'
                    and t.tgfoid = 'public.garder_factures_validees()'::regprocedure and t.tgenabled = 'O'
                    and (t.tgtype & 1) <> 0 and (t.tgtype & 2) <> 0 and (t.tgtype & 16) <> 0) then
    raise exception 'La garde des factures (déclencheur factures_emises_figees, ligne, avant la mise à jour) n''est pas en base telle que cette migration la suppose.';
  end if;
end
$garde$;

-- ══ 1. Les deux refus ══════════
create function public.garder_mentions_a_la_validation() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Les blancs que `trim` retire (ECMAScript, String.prototype.trim) : ceux de `v_blancs` d'`enregistrer_facture`, que le
  -- formulaire retire avant d'envoyer l'adresse (`tiersAdresse.trim() || null`).
  v_blancs constant text := chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200)
    || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
begin
  -- Le déclencheur ne s'appelle qu'au passage à « validée », après la garde des factures (l'ordre des noms) : la
  -- validation est légitime, et la ligne est celle que la validation fige. Un avoir suit sa facture.
  if new.type <> 'facture' then
    return new;
  end if;
  -- 19. JJ-Q4 : l'adresse du client d'une entreprise ou d'un organisme public.
  if new.type_client in ('assujetti', 'organisme_public')
     and btrim(coalesce(new.tiers_adresse, ''), v_blancs) = '' then
    raise exception 'L''adresse du client manque : une facture à une entreprise ou à un organisme public porte le nom complet et l''adresse de son client (CGI, ann. II, art. 242 nonies A, I, 1° ; code de commerce, art. L441-9, I). Elle se renseigne avant la validation : une facture validée ne se corrige que par un avoir.'
      using errcode = '22023';
  end if;
  -- 20. A7C-Q1 : la ligne à 0 % d'un redevable sans article, hors d'un régime d'e7a que la TVA française ne taxe pas.
  if new.statut_tva = 'redevable' and new.article_exoneration is null
     and coalesce(to_jsonb(new) ->> 'regime_international', 'taxable_en_france') = 'taxable_en_france'
     and exists (select 1 from public.facture_lignes l where l.facture_id = new.id and l.taux_tva = 0) then
    raise exception 'Une ligne est au taux 0 dans un dossier redevable de la TVA sans article d''exonération : la facture ne dirait pas pourquoi elle ne porte pas de TVA (CGI, ann. II, art. 242 nonies A, I). L''article d''exonération du dossier se choisit avant la validation, ou la ligne prend son taux ; des débours, payés au nom et pour le compte du client, restent hors de la facture (CGI, art. 267, II, 2°).'
      using errcode = '22023';
  end if;
  return new;
end
$$;

create trigger factures_emises_figees_mentions
  before update on public.factures_emises
  for each row
  when (new.statut = 'validee' and old.statut is distinct from 'validee')
  execute function public.garder_mentions_a_la_validation();

-- Une fonction de déclencheur ne s'appelle pas : personne ne l'exécute (la règle des `garder_*`).
revoke execute on function public.garder_mentions_a_la_validation() from public, anon, authenticated;

comment on function public.garder_mentions_a_la_validation() is
  'JJ-Q4 et A7C-Q1 (07/11/2026) : la validation d''une facture (non d''un avoir) se refuse, en 22023, après la garde des factures (déclencheur factures_emises_figees_mentions), sans l''adresse du client quand le client figé est une entreprise établie en France ou un organisme public (CGI, ann. II, art. 242 nonies A, I, 1° ; C. com., art. L441-9, I), puis avec une ligne au taux 0 quand elle fige le statut redevable sans article d''exonération, hors d''un régime d''e7a que la TVA française ne taxe pas.';
comment on trigger factures_emises_figees_mentions on public.factures_emises is
  'JJ-Q4 et A7C-Q1 : suit la garde des factures (factures_emises_figees, dont le nom est le début du sien) et précède la source de la vente ; ne juge que le passage à « validée ».';
