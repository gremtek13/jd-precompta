-- LA NUMÉROTATION QUI CONTINUE, EN BASE (ligne 51.5, premier groupe, étape A9a ; MEG1-Q5, tranchée par le cabinet le
-- 16/10/2026 : deux séries par dossier, celle du client et celle du cabinet mandataire, choisie selon QUI valide ; le
-- client qui quitte son ancien logiciel continue sa série). PRÉPARÉE le 10/11/2026, PAS APPLIQUÉE. Le récit :
-- HISTORIQUE.md, « A9A : LA NUMÉROTATION QUI CONTINUE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) » ; la conception : « A8 ET A9,
-- LES FACTURES REPRISES ET LA NUMÉROTATION QUI CONTINUE : LA CONCEPTION REMISE À JOUR » (06/11/2026), et sa source,
-- « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », § A.3.5 et § A.3.6. Son
-- essai : supabase/essais/numerotationContinue.sql ; son retour : supabase/preparees/retour/
-- 20261110100100_retour_numerotation_continue.sql ; le module qui redit ses refus et son formatage :
-- src/lib/numerotationContinue.ts ; le drapeau qui met ses deux tables au plan de sauvegarde : `NUMEROTATION_CONTINUE_PREVUE`,
-- baissé.
--
-- ELLE S'ÉCRIT PAR-DESSUS A8a (20261107210000_factures_importees, préparée, à coller AVANT celle-ci) : sa garde de tête
-- l'exige. À COLLER (l'outil retient ce texte : deux `drop constraint`) : dans l'éditeur SQL de Supabase, en UNE
-- transaction, avec sa ligne d'historique.
--
-- POURQUOI. Une seule série existe aujourd'hui par dossier (`attribuer_numero_facture` : F<année>-, A<année>-), quel que
-- soit qui valide, alors que P4 imprime déjà le mandat sur la facture que le cabinet valide : la DGFiP demande alors « une
-- racine propre au mandataire pour éviter les doublons de facture avec celles de son mandant » (G1.45). Et le client qui
-- reprend ses factures d'un ancien logiciel (A8a) doit pouvoir CONTINUER sa série : un numéro « unique basé sur une
-- séquence chronologique et continue » (CGI, ann. II, art. 242 nonies A, I, 7°), le changement de logiciel n'étant pas
-- une raison de séries distinctes que la doctrine cite (BOI-TVA-DECLA-30-20-20-10, § 80 à § 130).
--
-- CE QU'ELLE POSE :
--   1. Le MODÈLE de numéro (`modeles_numerotation`) : par dossier, par nature (facture, avoir) et par émetteur (le client,
--      le cabinet mandataire), un texte et deux jetons, `{AAAA}` (l'année de la date d'émission) et `{N:k}` (le compteur,
--      k chiffres au moins, de 1 à 9) ; le compteur repart de 1 chaque année (`annuel`) ou continue ; il s'applique à
--      partir d'une année (`depuis`), et le plus récemment posé l'emporte pour chaque année qu'il couvre ; le premier
--      numéro d'une série ouverte en cours d'année (`premier_numero`, pour l'année `depuis`). Un modèle absent est celui
--      d'hier pour le client — F{AAAA}-{N:4}, A{AAAA}-{N:4} — et, pour le cabinet, M{AAAA}-{N:4} et MA{AAAA}-{N:4}
--      (A9A-Q1). Refusé, sous les mots que `refus_du_modele` rend et que le module redit : un caractère hors de G1.05, pas
--      exactement un compteur, deux années, une espace en tête, en fin ou doublée, un compteur annuel sans l'année (deux
--      factures auraient le même numéro d'une année sur l'autre, et l'index unique du dossier ne connaît pas l'année),
--      plus de 35 caractères le compteur compté sur neuf chiffres, et — la garde d'hier (`garder_factures_validees`, son
--      cinquième refus) lisant le rang d'une facture après son premier tiret, `split_part(numero, '-', 2)::integer` — un
--      premier tiret que ne suit pas un nombre seul. Deux modèles qui ne sont pas la même série ne produisent jamais un
--      même numéro (`modeles_se_recouvrent`, exact) ; les factures et les avoirs d'un même émetteur partagent leur
--      compteur sous un même modèle (« selon ce que faisait l'ancien logiciel ») ; le client et le cabinet jamais (G1.45).
--      Le chef du cabinet seul le pose (`fixer_modele_numerotation`, A9A-Q2), comme la date de reprise (A8-Q2).
--   2. LA SÉRIE DE QUI VALIDE : `attribuer_numero_facture` (même signature ; `enregistrer_facture`, que cette migration
--      ne touche pas, l'appelle comme hier) prend le numéro dans la série du cabinet mandataire quand le cabinet valide
--      — le prédicat même qui pose `mandataire_nom` (`admin_du_dossier`, qui comprend le super-administrateur) —, dans
--      celle du client sinon ; formaté par le modèle en vigueur pour l'année de la facture ; repris du plus haut numéro de
--      la série (le motif tiré du modèle, ancré, le compteur canonique), validées ET reprises comprises, et du compteur ;
--      sous le verrou de la série (`facture_numerotation`, qui garde sa clé : la série d'hier s'y range sous `facture` et
--      `avoir`, toute autre sous `modele:<a|c>:<modèle>`, un compteur non annuel à l'année 0 — sa contrainte de type
--      remplacée).
--   3. LA CONTINUITÉ JUGÉE, avant de continuer une série qui porte une SUITE REPRISE (une facture reprise de l'ancien
--      logiciel, ou une fin confirmée) : la fin de la suite reprise CONFIRMÉE par le cabinet — le dernier numéro que
--      l'ancien logiciel y a émis (`confirmer_fin_de_serie`), au moins le plus haut repris, tant que l'application n'a rien
--      validé dans la série (A9A-Q3) — ; puis aucun trou du premier numéro à cette fin, sinon chaque trou NOMMÉ (les
--      premiers, en numéros) : il s'importe, ou le cabinet le lève, motif écrit (`lever_trous_de_numerotation`). Les deux
--      gestes se gardent dans `continuite_des_series`, paroles datées que rien ne modifie. Une série de l'application
--      seule (aucune reprise) ne se juge pas : sa suite se fait d'elle-même, comme hier.
--   4. LA CHRONOLOGIE DE LA SÉRIE, à la validation (le déclencheur `factures_emises_numerotation`) : une facture n'est
--      jamais datée d'avant la plus récente de sa série — le modèle de qui valide, pour son année —, validées ET reprises
--      (CGI, ann. II, art. 242 nonies A, I, 7°). Elle remplace le cinquième refus étendu d'A8a (`garder_factures_reprises`,
--      sa série lue `^[FA][0-9]{4}-[0-9]+$`), sous ses mots ; la garde d'hier, intacte (la migration préparée e7a la
--      remplace depuis la même empreinte), garde le sien. Et le numéro que la validation pose est celui de la série de qui
--      valide (une défense : seule `enregistrer_facture` valide, par `attribuer_numero_facture`).
--   5. LES FACTURES REPRISES FACE AUX SÉRIES DES MODÈLES : une reprise ne rejoint pas une série que l'application a déjà
--      continuée, et l'import qui la porte ne se retire plus dès que l'application l'a continuée — A8a le tenait pour la
--      forme F/A de l'application, ceci l'étend à tout modèle, sous le même verrou.
--   6. La contrainte `factures_emises_numero_de_sa_serie` relâchée à la forme de G1.05 pour toute facture numérotée : elle
--      ne peut pas lire le modèle (une autre table) ; c'est la validation qui le tient (point 4).
--   7. `etat_de_la_numerotation(p_dossier_id, p_annee)` : ce que la carte du cabinet (A9b) dira, série par série — le
--      modèle en vigueur, ce qui est repris et validé, la fin confirmée, les trous qui restent, le refus qui retiendrait
--      la prochaine validation, le prochain numéro.
--
-- CE QU'ELLE NE FAIT PAS : l'écran (A9b) ; l'accès du client « Ventes » aux deux tables (fermé : la carte est au
-- cabinet ; l'ouvrir se présente avec l'écran) ; le remplacement d'`enregistrer_facture` (que e7a et A8b remplacent :
-- celle-ci ne les gêne pas, dans aucun ordre) ni de `garder_factures_validees` (e7a). Une facture validée avant elle garde
-- son numéro ; la série d'hier continue pour le client, et le cabinet ouvre la sienne, M<année>-0001, à sa première
-- validation.
--
-- LES SOURCES (publiques ; les normes AFNOR XP Z12-012 et XP Z12-013 ne s'utilisent pas) : CGI, ann. II, art. 242 nonies A,
-- I, 7° (la séquence chronologique et continue) ; BOI-TVA-DECLA-30-20-20-10, § 80 à § 130 (les séries distinctes, un
-- préfixe par série, la facturation pour compte de tiers) ; BOI-TVA-DECLA-30-20-10-30 (le mandat de facturation) ; DGFiP,
-- spécifications externes de la facture électronique, annexe 7 v1.9, règles G1.05 (le numéro), G1.36 (la date) et G1.45
-- (l'unicité, la racine propre au mandataire).

-- ══ 0. GARDE DE TÊTE : la base est celle que cette migration remplace ══════════

do $garde$
begin
  if to_regclass('public.modeles_numerotation') is not null or to_regclass('public.continuite_des_series') is not null
     or to_regprocedure('public.numerotation_suivante(uuid, integer, text)') is not null
     or to_regprocedure('public.fixer_modele_numerotation(uuid, text, text, text, boolean, integer, integer)') is not null then
    raise exception 'La numérotation qui continue est déjà en base : cette migration ne se rejoue pas.';
  end if;
  -- A8a d'abord : l'état « importee », ses tables, sa garde.
  if to_regclass('public.factures_importees') is null or to_regclass('public.imports_factures') is null
     or to_regprocedure('public.garder_factures_reprises()') is null then
    raise exception 'Les factures reprises (A8a, 20261107210000_factures_importees) ne sont pas en base : elles précèdent cette migration.';
  end if;
  -- Les trois fonctions remplacées, à l'empreinte de leur corps (fins de ligne ramenées à \n : une migration collée peut
  -- les porter en \r\n) : `attribuer_numero_facture` et `prochain_numero_facture` de l'export (20261007193006), et la
  -- garde des factures reprises d'A8a.
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, E'\r\n', E'\n')), ',' order by p.proname collate "C")
        from pg_proc p
       where p.oid in (to_regprocedure('public.attribuer_numero_facture(uuid, integer, text)'),
                       to_regprocedure('public.prochain_numero_facture(uuid, integer, text)'),
                       to_regprocedure('public.garder_factures_reprises()')))
     is distinct from 'attribuer_numero_facture=27b86edc3f6046f8f7145c6395483aac,'
                   || 'garder_factures_reprises=b9b7127e1d6aa92b565dcd6940960d1c,'
                   || 'prochain_numero_facture=44e6b35cf10d88dbe10dad1eb03a80a8' then
    raise exception 'attribuer_numero_facture, prochain_numero_facture ou garder_factures_reprises n''est plus celle que cette migration remplace : la relire contre la base avant de l''appliquer.';
  end if;
  -- Les deux contraintes remplacées, à l'empreinte de leur définition : celle d'A8a, et celle de l'export (20260909082322).
  if (select string_agg(c.conname || '=' || md5(pg_get_constraintdef(c.oid)), ',' order by c.conname collate "C")
        from pg_constraint c
       where (c.conrelid = 'public.factures_emises'::regclass and c.conname = 'factures_emises_numero_de_sa_serie')
          or (c.conrelid = 'public.facture_numerotation'::regclass and c.conname = 'facture_numerotation_type_check'))
     is distinct from 'facture_numerotation_type_check=7b4c77d1327203aac5938a1162c89f4e,'
                   || 'factures_emises_numero_de_sa_serie=bcc820091010e5c9db6066ce63a766ba' then
    raise exception 'Les contraintes du numéro d''une facture ou de son compteur ne sont plus celles que cette migration remplace : la relire contre la base avant de l''appliquer.';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.facture_numerotation'::regclass and c.contype = 'p'
                    and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (dossier_id, annee, type)') then
    raise exception 'La clé du compteur des factures n''est plus (dossier_id, annee, type).';
  end if;
  -- Ce que la numérotation suppose d'`enregistrer_facture` — le texte d'aujourd'hui, celui de la migration préparée e7a,
  -- celui qu'A8b écrira — : le numéro pris par `attribuer_numero_facture` pour l'année de la date d'émission, et le
  -- mandataire posé selon `admin_du_dossier`, le prédicat que la série du cabinet suit.
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'enregistrer_facture') <> 1
     or (select position('v_numero := attribuer_numero_facture(p_dossier_id, extract(year from v_date_emission)::integer, v_type);'
                         in replace(p.prosrc, E'\r\n', E'\n')) = 0
                or position('v_cabinet := public.admin_du_dossier(p_dossier_id);' in p.prosrc) = 0
                or position('mandataire_nom = v_mandataire' in p.prosrc) = 0
           from pg_proc p where p.oid = to_regprocedure('public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean)')) then
    raise exception 'enregistrer_facture ne prend plus son numéro, ou ne pose plus son mandataire, comme cette migration le suppose : la relire contre la base avant de l''appliquer.';
  end if;
  if to_regprocedure('public.gere_les_ventes(uuid)') is null or to_regprocedure('public.admin_du_dossier(uuid)') is null
     or to_regprocedure('public.est_chef_du_cabinet(uuid)') is null or to_regprocedure('public.is_super_admin()') is null
     or to_regprocedure('public.restauration_des_factures(uuid)') is null then
    raise exception 'Les fonctions que la numérotation appelle manquent.';
  end if;
  if exists (select 1 from public.facture_numerotation n where n.type not in ('facture', 'avoir')) then
    raise exception 'Le compteur des factures porte une série que cette migration ne connaît pas.';
  end if;
end
$garde$;

-- ══ 1. LE MODÈLE : SES RÈGLES, SON FORMATAGE, SON MOTIF (des fonctions pures) ══════════

-- Les refus d'un modèle, dans cet ordre, sous les mots que src/lib/numerotationContinue.ts redit (null : il est reçu).
create function public.refus_du_modele(p_modele text, p_annuel boolean) returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_reste text;
  v_k integer;
  v_segment text;
  v_longueur integer;
begin
  if p_modele is null then
    return 'Un modèle de numéro s''écrit en lettres, chiffres, espaces et signes « - + _ / », avec l''année {AAAA} et le compteur {N:k}, k de 1 à 9 (DGFiP, annexe 7, G1.05).';
  end if;
  v_reste := regexp_replace(regexp_replace(p_modele, '\{AAAA\}', '', 'g'), '\{N:[1-9]\}', '', 'g');
  if v_reste !~ '^[-+_/A-Za-z0-9 ]*$' then
    return 'Un modèle de numéro s''écrit en lettres, chiffres, espaces et signes « - + _ / », avec l''année {AAAA} et le compteur {N:k}, k de 1 à 9 (DGFiP, annexe 7, G1.05).';
  end if;
  if (select count(*) from regexp_matches(p_modele, '\{N:[1-9]\}', 'g')) <> 1 then
    return 'Un modèle de numéro porte un compteur, et un seul : {N:k}, au moins k chiffres (k de 1 à 9).';
  end if;
  if (select count(*) from regexp_matches(p_modele, '\{AAAA\}', 'g')) > 1 then
    return 'Un modèle de numéro porte l''année une fois au plus : {AAAA}.';
  end if;
  if left(p_modele, 1) = ' ' or right(p_modele, 1) = ' ' or strpos(p_modele, '  ') > 0 then
    return 'Un numéro ne commence ni ne finit par une espace, et n''en porte jamais deux de suite (DGFiP, annexe 7, G1.05).';
  end if;
  if coalesce(p_annuel, false) and strpos(p_modele, '{AAAA}') = 0 then
    return 'Un compteur qui repart de 1 chaque année porte l''année dans le numéro, {AAAA} : sans elle, deux factures auraient le même numéro d''une année sur l''autre.';
  end if;
  -- La garde d'hier lit le rang d'une facture après son premier tiret (`split_part(numero, '-', 2)::integer`) : ce qui
  -- l'y attend est un nombre seul, neuf chiffres au plus (un entier sur 32 bits).
  if strpos(p_modele, '-') > 0 then
    v_segment := split_part(substr(p_modele, strpos(p_modele, '-') + 1), '-', 1);
    if not (v_segment ~ '^\{N:[1-9]\}$' or replace(v_segment, '{AAAA}', '0000') ~ '^[0-9]{1,9}$') then
      return 'Après son premier tiret, un numéro porte un nombre seul jusqu''au tiret suivant — le compteur, l''année ou des chiffres, neuf au plus — : la garde des factures y lit le rang d''une facture pour en suivre l''ordre.';
    end if;
  end if;
  v_k := substring(p_modele from '\{N:([1-9])\}')::integer;
  v_longueur := char_length(regexp_replace(replace(p_modele, '{AAAA}', '0000'), '\{N:[1-9]\}', '', 'g')) + greatest(v_k, 9);
  if v_longueur > 35 then
    return format('Ce modèle donnerait des numéros de %s caractères, le compteur compté sur neuf chiffres : un numéro en compte 35 au plus (DGFiP, annexe 7, G1.05).',
                  v_longueur);
  end if;
  return null;
end
$$;

comment on function public.refus_du_modele(text, boolean) is
  'Le refus d''un modèle de numéro (A9a), ou null : l''alphabet de G1.05 et les jetons {AAAA} et {N:k} (k de 1 à 9), un compteur et un seul, l''année une fois au plus, les espaces, l''année d''un compteur annuel, le nombre seul après le premier tiret (la garde d''hier y lit le rang), 35 caractères au plus. Redit par src/lib/numerotationContinue.ts.';

-- Le numéro d'un compteur : l'année sur quatre chiffres, le compteur sur k chiffres au moins (jamais tronqué).
create function public.numero_du_modele(p_modele text, p_annee integer, p_compteur integer) returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(replace(p_modele, '{AAAA}', lpad(p_annee::text, 4, '0')), '\{N:[1-9]\}',
           lpad(p_compteur::text, greatest(substring(p_modele from '\{N:([1-9])\}')::integer, char_length(p_compteur::text)), '0'))
$$;

-- Le motif d'une série, ancré, son compteur pour seul groupe : canonique — k chiffres, ou plus sans zéro de tête —, ce que
-- `numero_du_modele` produit et rien d'autre. L'année est celle de la série pour un compteur annuel, toute année sinon.
-- Le seul métacaractère de l'alphabet de G1.05 hors des jetons, le « + », s'échappe.
create function public.motif_du_modele(p_modele text, p_annuel boolean, p_annee integer) returns text
language sql
immutable
set search_path = public
as $$
  select '^' || regexp_replace(
           replace(replace(p_modele, '+', '\+'), '{AAAA}', case when p_annuel then lpad(p_annee::text, 4, '0') else '[0-9]{4}' end),
           '\{N:[1-9]\}',
           '([0-9]{' || substring(p_modele from '\{N:([1-9])\}') || '}|[1-9][0-9]{' || substring(p_modele from '\{N:([1-9])\}') || ',})')
         || '$'
$$;

-- Deux modèles peuvent-ils produire un même numéro ? Chacun est une tête, un compteur d'au moins k chiffres et une queue
-- (l'année, quatre chiffres quelconques : « # ») ; pour chaque longueur où les deux tiennent, position par position, un
-- caractère fixe contre un autre, ou contre un chiffre. Au-delà de la plus longue tête, de la plus longue queue et du plus
-- long compteur, rien ne change plus : la recherche s'arrête là. Exact (le compteur pris pour des chiffres quelconques :
-- prudent d'un zéro de tête).
create function public.modeles_se_recouvrent(p_un text, p_autre text) returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  h1 text := replace(substr(p_un, 1, strpos(p_un, '{N:') - 1), '{AAAA}', '####');
  t1 text := replace(substr(p_un, strpos(p_un, '{N:') + 5), '{AAAA}', '####');
  k1 integer := substring(p_un from '\{N:([1-9])\}')::integer;
  h2 text := replace(substr(p_autre, 1, strpos(p_autre, '{N:') - 1), '{AAAA}', '####');
  t2 text := replace(substr(p_autre, strpos(p_autre, '{N:') + 5), '{AAAA}', '####');
  k2 integer := substring(p_autre from '\{N:([1-9])\}')::integer;
  v_min integer;
  v_max integer;
  v_c1 text;
  v_c2 text;
  v_ensemble boolean;
begin
  v_min := greatest(char_length(h1) + k1 + char_length(t1), char_length(h2) + k2 + char_length(t2));
  v_max := greatest(v_min, greatest(char_length(h1), char_length(h2)) + greatest(char_length(t1), char_length(t2))
                           + greatest(k1, k2)) + 1;
  for l in v_min .. v_max loop
    v_ensemble := true;
    for p in 0 .. l - 1 loop
      v_c1 := case when p < char_length(h1) then substr(h1, p + 1, 1)
                   when p >= l - char_length(t1) then substr(t1, p - (l - char_length(t1)) + 1, 1)
                   else '#' end;
      v_c2 := case when p < char_length(h2) then substr(h2, p + 1, 1)
                   when p >= l - char_length(t2) then substr(t2, p - (l - char_length(t2)) + 1, 1)
                   else '#' end;
      if not (v_c1 = v_c2 or (v_c1 = '#' and v_c2 ~ '^[0-9]$') or (v_c2 = '#' and v_c1 ~ '^[0-9]$')) then
        v_ensemble := false;
        exit;
      end if;
    end loop;
    if v_ensemble then
      return true;
    end if;
  end loop;
  return false;
end
$$;

-- Le modèle d'un emplacement qui n'en a pas : celui d'hier pour le client ; une racine propre pour le cabinet (A9A-Q1).
create function public.modele_par_defaut(p_nature text, p_emetteur text) returns text
language sql
immutable
set search_path = public
as $$
  select case p_emetteur || '/' || p_nature
           when 'client/facture' then 'F{AAAA}-{N:4}'
           when 'client/avoir' then 'A{AAAA}-{N:4}'
           when 'mandataire/facture' then 'M{AAAA}-{N:4}'
           when 'mandataire/avoir' then 'MA{AAAA}-{N:4}'
         end
$$;

-- La clé d'une série dans `facture_numerotation` : `facture` et `avoir` pour celle d'hier (les lignes en place y restent),
-- `modele:<a|c>:<modèle>` pour toute autre (a : annuel, c : continu).
create function public.cle_de_serie(p_modele text, p_annuel boolean) returns text
language sql
immutable
set search_path = public
as $$
  select case when p_annuel and p_modele = 'F{AAAA}-{N:4}' then 'facture'
              when p_annuel and p_modele = 'A{AAAA}-{N:4}' then 'avoir'
              else 'modele:' || case when p_annuel then 'a' else 'c' end || ':' || p_modele end
$$;

-- Ce que les messages disent d'une série et d'un emplacement.
create function public.libelle_de_serie(p_modele text, p_annuel boolean, p_annee integer) returns text
language sql
immutable
set search_path = public
as $$
  select 'du modèle ' || p_modele || case when p_annuel then ' (' || p_annee::text || ')' else '' end
$$;

create function public.libelle_d_emplacement(p_nature text, p_emetteur text) returns text
language sql
immutable
set search_path = public
as $$
  select case p_nature when 'facture' then 'des factures' else 'des avoirs' end
         || case p_emetteur when 'client' then ' du client' else ' du cabinet mandataire' end
$$;

-- ══ 2. LES DEUX TABLES ══════════

create table public.modeles_numerotation (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  nature text not null check (nature in ('facture', 'avoir')),
  emetteur text not null check (emetteur in ('client', 'mandataire')),
  modele text not null,
  annuel boolean not null,
  depuis integer not null check (depuis between 2000 and 2099),
  premier_numero integer not null default 1 check (premier_numero between 1 and 999999999),
  pose_par uuid,
  pose_le timestamptz not null default clock_timestamp(),
  constraint modeles_numerotation_modele_recu check (public.refus_du_modele(modele, annuel) is null)
);

create index modeles_numerotation_dossier_idx on public.modeles_numerotation (dossier_id, nature, emetteur, depuis);

comment on table public.modeles_numerotation is
  'Le modèle de numéro d''un dossier (A9a, MEG1-Q5) : par nature (facture, avoir) et par émetteur (le client ; le cabinet mandataire, G1.45), un texte et les jetons {AAAA} et {N:k}, annuel ou continu, à partir d''une année (depuis), le premier numéro d''une série ouverte en cours d''année (premier_numero, pour l''année depuis). Le plus récemment posé l''emporte pour chaque année qu''il couvre ; sans modèle, celui d''hier (modele_par_defaut). Posé par fixer_modele_numerotation seule (le chef du cabinet), et la restauration ; jamais modifié ; lu par le cabinet du dossier.';

create table public.continuite_des_series (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  modele text not null,
  annuel boolean not null,
  annee integer not null,
  geste text not null check (geste in ('fin', 'trous')),
  premier integer not null check (premier between 1 and 999999999),
  dernier integer not null check (dernier between 1 and 999999999),
  motif text not null check (btrim(motif) <> '' and char_length(motif) <= 1000),
  pose_par uuid,
  pose_le timestamptz not null default clock_timestamp(),
  constraint continuite_des_series_ordonnee check (dernier >= premier),
  constraint continuite_des_series_fin_d_un_numero check (geste <> 'fin' or premier = dernier),
  constraint continuite_des_series_annee check (case when annuel then annee between 2000 and 2099 else annee = 0 end)
);

create index continuite_des_series_dossier_idx on public.continuite_des_series (dossier_id, modele, annee);

comment on table public.continuite_des_series is
  'Les paroles du cabinet sur la suite reprise d''une série (A9a) : la fin confirmée (geste fin : le dernier numéro que l''ancien logiciel y a émis, premier = dernier) et les trous levés (geste trous : un intervalle de compteurs qui manquent, motif écrit). La série : son modèle, annuel ou continu, son année (0 pour un compteur continu). Posées par confirmer_fin_de_serie et lever_trous_de_numerotation seules (le chef du cabinet), et la restauration ; jamais modifiées ; lues par le cabinet du dossier.';

alter table public.modeles_numerotation enable row level security;
alter table public.continuite_des_series enable row level security;

create policy modeles_numerotation_lecture on public.modeles_numerotation
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy modeles_numerotation_restauration on public.modeles_numerotation
  for insert to authenticated with check (public.is_super_admin());
create policy continuite_des_series_lecture on public.continuite_des_series
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy continuite_des_series_restauration on public.continuite_des_series
  for insert to authenticated with check (public.is_super_admin());

-- La double authentification exigée (préparée, 20261107160000) : appliquée avant celle-ci, sa policy restrictive se pose
-- ici sur les deux tables neuves ; appliquée après, sa boucle sur pg_class les prend d'elle-même.
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    create policy deux_facteurs on public.modeles_numerotation as restrictive for all to authenticated
      using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()));
    create policy deux_facteurs on public.continuite_des_series as restrictive for all to authenticated
      using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()));
  end if;
end
$deux_facteurs$;

-- La garde des deux tables : une ligne naît par sa fonction (le réglage `jd.numerotation` la nomme) ou par la restauration,
-- ne se modifie jamais, ne part qu'avec son dossier.
create function public.garder_tables_de_numerotation() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quoi text := case tg_table_name when 'modeles_numerotation' then 'Un modèle de numéro'
                                    else 'Une fin de suite confirmée ou une levée de trous' end;
begin
  if tg_op = 'UPDATE' then
    raise exception '% ne se modifie pas : un nouveau geste du cabinet le remplace ou le complète.', v_quoi
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception '% ne se supprime pas : c''est une parole datée du cabinet.', v_quoi using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.numerotation', true), '') is distinct from new.id::text
     and not public.restauration_des_factures(new.dossier_id) then
    raise exception '% ne se pose que par sa fonction, qui le juge.', v_quoi using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger modeles_numerotation_garde
  before insert or update or delete on public.modeles_numerotation
  for each row execute function public.garder_tables_de_numerotation();
create trigger continuite_des_series_garde
  before insert or update or delete on public.continuite_des_series
  for each row execute function public.garder_tables_de_numerotation();

-- ══ 3. LE MODÈLE EN VIGUEUR, LA SÉRIE D'UN NUMÉRO, LE JUGEMENT D'UNE SÉRIE ══════════

-- Le modèle d'un emplacement pour une année : le plus récemment posé parmi ceux qui la couvrent, ou celui d'hier.
create function public.modele_en_vigueur(p_dossier_id uuid, p_nature text, p_emetteur text, p_annee integer)
returns table (vigueur_id uuid, vigueur_modele text, vigueur_annuel boolean, vigueur_premier integer, vigueur_depuis integer)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.modele, v.annuel, v.premier_numero, v.depuis
    from (select m.id, m.modele, m.annuel, m.premier_numero, m.depuis
            from public.modeles_numerotation m
           where m.dossier_id = p_dossier_id and m.nature = p_nature and m.emetteur = p_emetteur and m.depuis <= p_annee
           order by m.pose_le desc, m.id desc
           limit 1) v
  union all
  select null::uuid, public.modele_par_defaut(p_nature, p_emetteur), true, 1, null::integer
   where not exists (select 1 from public.modeles_numerotation m
                      where m.dossier_id = p_dossier_id and m.nature = p_nature and m.emetteur = p_emetteur
                        and m.depuis <= p_annee)
$$;

-- La série d'un numéro, pour l'année de sa date : celle du modèle en vigueur, parmi les quatre emplacements, dont le
-- motif le lit (deux séries ne se recouvrent jamais : une au plus, ou un modèle que deux emplacements partagent).
create function public.serie_d_un_numero(p_dossier_id uuid, p_numero text, p_annee integer)
returns table (serie_modele text, serie_annuel boolean)
language sql
stable
security definer
set search_path = public
as $$
  select distinct v.vigueur_modele, v.vigueur_annuel
    from (values ('facture', 'client'), ('avoir', 'client'), ('facture', 'mandataire'), ('avoir', 'mandataire')) as e(nature, emetteur)
   cross join lateral public.modele_en_vigueur(p_dossier_id, e.nature, e.emetteur, p_annee) v
   where p_numero ~ public.motif_du_modele(v.vigueur_modele, v.vigueur_annuel, p_annee)
$$;

-- Le jugement d'une série pour une année (sans verrou : `numerotation_suivante` le prend avant de l'appeler). Une série
-- porte une SUITE REPRISE quand une facture reprise de l'ancien logiciel en a le motif, ou qu'une fin y est confirmée ;
-- alors, tant que l'application n'y a rien validé, la fin doit être confirmée, au moins au plus haut numéro repris ; et
-- aucun compteur ne manque du premier numéro à la fin (ou au plus haut numéro de la série), sauf ceux que le cabinet a
-- levés. Une série de l'application seule ne se juge pas. Le refus nomme les premiers trous, en numéros.
create function public.jugement_de_la_serie(p_dossier_id uuid, p_modele text, p_annuel boolean, p_premier_numero integer,
                                            p_depuis integer, p_annee integer)
returns table (serie_cle text, serie_annee integer, serie_motif text, serie_premier integer, serie_emis numeric,
               serie_importes integer, serie_valides integer, serie_fin integer, serie_trous jsonb, serie_refus text,
               serie_prochain numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_motif text := public.motif_du_modele(p_modele, p_annuel, p_annee);
  v_annee integer := case when p_annuel then p_annee else 0 end;
  v_premier integer := case when not p_annuel or p_depuis = p_annee then coalesce(p_premier_numero, 1) else 1 end;
  v_emis numeric;
  v_max_repris numeric;
  v_importes integer;
  v_valides integer;
  v_fin integer;
  v_haut numeric;
  v_trous jsonb := '[]'::jsonb;
  v_refus text;
  v_noms text;
  v_nombre integer;
begin
  select max(e.c), max(e.c) filter (where e.statut = 'importee'),
         count(*) filter (where e.statut = 'importee'), count(*) filter (where e.statut = 'validee')
    into v_emis, v_max_repris, v_importes, v_valides
    from (select f.statut, substring(f.numero from v_motif)::numeric as c
            from public.factures_emises f
           where f.dossier_id = p_dossier_id and f.numero ~ v_motif) e;
  select max(l.dernier) into v_fin
    from public.continuite_des_series l
   where l.dossier_id = p_dossier_id and l.modele = p_modele and l.annuel = p_annuel and l.annee = v_annee
     and l.geste = 'fin';

  if v_importes > 0 or v_fin is not null then
    if v_valides = 0 and (v_fin is null or v_fin < v_max_repris) then
      v_refus := format('La suite reprise de la série %s n''est pas confirmée : le cabinet dit le dernier numéro que l''ancien logiciel y a émis (%s au moins) avant que l''application la continue.',
                        public.libelle_de_serie(p_modele, p_annuel, p_annee),
                        public.numero_du_modele(p_modele, p_annee, greatest(coalesce(v_max_repris, 1), 1)::integer));
    end if;
    v_haut := greatest(coalesce(v_emis, 0), coalesce(v_fin, 0));
    -- Les trous : ce que ni un numéro de la série, ni une levée ne couvre, du premier numéro au plus haut ; deux bornes
    -- sentinelles encadrent l'intervalle, et chaque écart entre deux couvertures consécutives en est un.
    if v_haut >= v_premier then
    with couvert as (
      select e.c as debut, e.c as fin
        from (select substring(f.numero from v_motif)::numeric as c
                from public.factures_emises f
               where f.dossier_id = p_dossier_id and f.numero ~ v_motif) e
       where e.c between v_premier and v_haut
      union all
      select greatest(l.premier, v_premier), least(l.dernier, v_haut)
        from public.continuite_des_series l
       where l.dossier_id = p_dossier_id and l.modele = p_modele and l.annuel = p_annuel and l.annee = v_annee
         and l.geste = 'trous' and l.dernier >= v_premier and l.premier <= v_haut
      union all
      select v_premier - 1, v_premier - 1
      union all
      select v_haut + 1, v_haut + 1
    ), suite as (
      select c.debut, max(c.fin) over (order by c.debut, c.fin rows between unbounded preceding and 1 preceding) as avant
        from couvert c
    )
    select coalesce(jsonb_agg(jsonb_build_array(s.avant + 1, s.debut - 1) order by s.debut), '[]'::jsonb)
      into v_trous
      from suite s
     where s.debut > s.avant + 1;
    end if;
    if v_refus is null and jsonb_array_length(v_trous) > 0 then
      select string_agg(case when (t.v->>0)::numeric = (t.v->>1)::numeric
                               then public.numero_du_modele(p_modele, p_annee, (t.v->>0)::integer)
                             else public.numero_du_modele(p_modele, p_annee, (t.v->>0)::integer) || ' à '
                                  || public.numero_du_modele(p_modele, p_annee, (t.v->>1)::integer) end,
                        ', ' order by t.rang)
        into v_noms
        from jsonb_array_elements(v_trous) with ordinality as t(v, rang)
       where t.rang <= 5;
      select coalesce(sum((t.v->>1)::numeric - (t.v->>0)::numeric + 1), 0)::integer into v_nombre
        from jsonb_array_elements(v_trous) t(v);
      v_refus := format('La série %s a des trous : %s%s. Chaque numéro manquant s''importe, ou le cabinet le lève, motif écrit, avant que l''application continue la série.',
                        public.libelle_de_serie(p_modele, p_annuel, p_annee), v_noms,
                        case when jsonb_array_length(v_trous) > 5
                             then ' — et ' || case when jsonb_array_length(v_trous) = 6 then 'un intervalle'
                                                   else (jsonb_array_length(v_trous) - 5)::text || ' intervalles' end
                                  || ' de plus, ' || v_nombre::text || ' numéros manquants en tout'
                             else '' end);
    end if;
  end if;

  return query select public.cle_de_serie(p_modele, p_annuel), v_annee, v_motif, v_premier, v_emis,
                      coalesce(v_importes, 0), coalesce(v_valides, 0), v_fin, v_trous, v_refus,
                      greatest(coalesce(v_emis, 0), coalesce(v_fin, 0), v_premier - 1) + 1;
end
$$;

-- ══ 4. LE NUMÉRO D'UNE VALIDATION : LA SÉRIE DE QUI VALIDE ══════════

-- Le numéro suivant de la série de qui valide (le cabinet : son mandataire, G1.45 ; un accès « Ventes » : le client), au
-- modèle en vigueur pour l'année, sous le verrou de la série ; la continuité jugée ; le compteur avancé. Interne :
-- `attribuer_numero_facture` (le numéro) et `prochain_numero_facture` (le compteur) l'enveloppent, et seule
-- `enregistrer_facture` appelle la première, dans la transaction qui valide la facture.
create function public.numerotation_suivante(p_dossier_id uuid, p_annee integer, p_type text,
                                             out numero_attribue text, out compteur_attribue integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emetteur text;
  v_m record;
  v_j record;
  v_cle text;
  v_annee_cle integer;
  v_compteur integer;
  v_suivant numeric;
  v_texte text;
begin
  if p_type not in ('facture', 'avoir') then
    raise exception 'Type de numérotation invalide : %', p_type using errcode = '22023';
  end if;
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- QUI valide : le cabinet émet au nom et pour le compte de son client (BOI-TVA-DECLA-30-20-10-30), le prédicat même
  -- qui pose `mandataire_nom` dans `enregistrer_facture` ; un accès « Ventes », le client lui-même.
  v_emetteur := case when public.admin_du_dossier(p_dossier_id) then 'mandataire' else 'client' end;
  select * into v_m from public.modele_en_vigueur(p_dossier_id, p_type, v_emetteur, p_annee);
  v_cle := public.cle_de_serie(v_m.vigueur_modele, v_m.vigueur_annuel);
  v_annee_cle := case when v_m.vigueur_annuel then p_annee else 0 end;
  -- Le verrou de la série, tenu jusqu'à la fin de la transaction : deux validations, ou une validation et une reprise
  -- dans la même série, se suivent. La ligne du compteur ferme aussi la porte de la restauration du dossier.
  insert into public.facture_numerotation (dossier_id, annee, type, dernier_numero)
  values (p_dossier_id, v_annee_cle, v_cle, 0)
  on conflict (dossier_id, annee, type) do nothing;
  select n.dernier_numero into v_compteur
    from public.facture_numerotation n
   where n.dossier_id = p_dossier_id and n.annee = v_annee_cle and n.type = v_cle
     for update;
  select * into v_j
    from public.jugement_de_la_serie(p_dossier_id, v_m.vigueur_modele, v_m.vigueur_annuel, v_m.vigueur_premier,
                                     v_m.vigueur_depuis, p_annee);
  if v_j.serie_refus is not null then
    raise exception '%', v_j.serie_refus using errcode = '22023';
  end if;
  v_suivant := greatest(v_compteur::numeric + 1, v_j.serie_prochain);
  if v_suivant > 999999999 then
    raise exception 'La série % a épuisé son compteur : un numéro y porte 999 999 999 au plus.',
      public.libelle_de_serie(v_m.vigueur_modele, v_m.vigueur_annuel, p_annee) using errcode = '22023';
  end if;
  compteur_attribue := v_suivant::integer;
  update public.facture_numerotation set dernier_numero = compteur_attribue
   where dossier_id = p_dossier_id and annee = v_annee_cle and type = v_cle;
  numero_attribue := public.numero_du_modele(v_m.vigueur_modele, p_annee, compteur_attribue);
  -- La garde d'hier ordonne les validées de même début (`split_part(numero, '-', 1)`) par le nombre qui suit leur premier
  -- tiret : un numéro d'un autre modèle, sans ce nombre, l'y ferait échouer. Le modèle de chaque série l'interdit en
  -- lui-même ; deux séries le pourraient encore ensemble (l'une sans tiret, l'autre qui commence comme ses numéros) :
  -- la validation le dit ici, avant que la garde ne lève.
  select f.numero into v_texte
    from public.factures_emises f
   where f.dossier_id = p_dossier_id and f.statut = 'validee'
     and split_part(f.numero, '-', 1) = split_part(numero_attribue, '-', 1)
     and split_part(f.numero, '-', 2) !~ '^[0-9]{1,9}$'
   order by f.numero collate "C"
   limit 1;
  if v_texte is not null then
    raise exception 'Le numéro % commencerait comme la facture % sans qu''un nombre suive son premier tiret : la garde des factures ne saurait les ordonner. Le modèle de l''une des deux séries est à changer.',
      numero_attribue, v_texte using errcode = '22023';
  end if;
end
$$;

-- `attribuer_numero_facture` et `prochain_numero_facture` : leur signature et leurs droits d'hier (personne ne les appelle
-- que `enregistrer_facture`, la première), le numéro et le compteur de la série de qui valide.
create or replace function public.attribuer_numero_facture(p_dossier_id uuid, p_annee integer, p_type text default 'facture')
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Le contrôle d'accès, la série de qui valide, son verrou et sa continuité vivent dans numerotation_suivante (A9a).
  return (public.numerotation_suivante(p_dossier_id, p_annee, p_type)).numero_attribue;
end;
$$;

create or replace function public.prochain_numero_facture(p_dossier_id uuid, p_annee integer, p_type text default 'facture')
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Malgré son nom, elle CONSOMME un numéro (A9a : celui de la série de qui valide, numerotation_suivante).
  return (public.numerotation_suivante(p_dossier_id, p_annee, p_type)).compteur_attribue;
end;
$$;

comment on function public.prochain_numero_facture(uuid, integer, text) is
  'Le compteur suivant de la série de qui valide (A9a : le cabinet, son mandataire ; un accès « Ventes », le client), au modèle en vigueur pour l''année, repris du plus haut numéro de la série — validées et reprises — quand le compteur manque ou retarde, la continuité d''une suite reprise jugée. Il le CONSOMME. Personne ne l''appelle ; attribuer_numero_facture, le numéro formaté, n''est appelée que par enregistrer_facture.';

-- Le compteur d'une série autre que celle d'hier se range sous sa clé (`cle_de_serie`), un compteur continu à l'année 0.
alter table public.facture_numerotation
  drop constraint facture_numerotation_type_check,
  add constraint facture_numerotation_type_check
    check (type in ('facture', 'avoir') or (type ~ '^modele:[ac]:' and char_length(type) <= 60)),
  add constraint facture_numerotation_annee_du_compteur
    check (annee = 0 or annee between 1000 and 9999);

-- ══ 5. LA CONTRAINTE DU NUMÉRO : LA FORME DE G1.05, LE MODÈLE TENU PAR LA VALIDATION ══════════

alter table public.factures_emises
  drop constraint factures_emises_numero_de_sa_serie,
  add constraint factures_emises_numero_de_sa_serie
    check (char_length(numero) <= 35 and numero ~ '^[-+_/A-Za-z0-9]( ?[-+_/A-Za-z0-9])*$');

-- ══ 6. LA GARDE DE LA NUMÉROTATION : LA CHRONOLOGIE, LES REPRISES FACE AUX SÉRIES ══════════

-- Le déclencheur suit la marque d'acompte et précède la source de la vente (l'ordre des noms) : la garde d'hier, celle
-- des mentions et celle des reprises ont jugé la légitimité de l'écriture.
create function public.garder_la_numerotation() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_annee integer;
  v_m record;
  v_s record;
  v_motif text;
  v_texte text;
  v_date date;
  v_statut text;
begin
  if tg_op = 'DELETE' then
    -- Le retrait d'une facture reprise (retirer_import) : refusé dès que l'application a continué sa série — retirer un
    -- numéro déjà suivi creuserait un trou. La cascade d'un dossier qu'on supprime passe.
    if old.statut <> 'importee' or not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    v_annee := extract(year from old.date_emission)::integer;
    for v_s in select * from public.serie_d_un_numero(old.dossier_id, old.numero, v_annee) loop
      select f.numero into v_texte
        from public.factures_emises f
       where f.dossier_id = old.dossier_id and f.statut = 'validee'
         and f.numero ~ public.motif_du_modele(v_s.serie_modele, v_s.serie_annuel, v_annee)
       order by f.numero collate "C"
       limit 1;
      if v_texte is not null then
        raise exception 'L''application a continué la série de la facture reprise % (la facture %) : son import ne se retire plus, il y creuserait un trou.',
          old.numero, v_texte using errcode = '23514';
      end if;
    end loop;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- Une facture reprise ne rejoint pas une série que l'application a déjà continuée ; sous le verrou de la série, qu'une
    -- validation prend aussi. L'import l'annonce (`jd.import_facture`, que la garde des reprises exige, la restauration
    -- exceptée) ; la restauration réinsère telles quelles.
    if new.statut = 'importee' and coalesce(current_setting('jd.import_facture', true), '') = new.id::text then
      v_annee := extract(year from new.date_emission)::integer;
      for v_s in select * from public.serie_d_un_numero(new.dossier_id, new.numero, v_annee) loop
        insert into public.facture_numerotation (dossier_id, annee, type, dernier_numero)
        values (new.dossier_id, case when v_s.serie_annuel then v_annee else 0 end,
                public.cle_de_serie(v_s.serie_modele, v_s.serie_annuel), 0)
        on conflict (dossier_id, annee, type) do nothing;
        perform 1 from public.facture_numerotation n
          where n.dossier_id = new.dossier_id and n.annee = case when v_s.serie_annuel then v_annee else 0 end
            and n.type = public.cle_de_serie(v_s.serie_modele, v_s.serie_annuel)
          for update;
        select f.numero into v_texte
          from public.factures_emises f
         where f.dossier_id = new.dossier_id and f.statut = 'validee'
           and f.numero ~ public.motif_du_modele(v_s.serie_modele, v_s.serie_annuel, v_annee)
         order by f.numero collate "C"
         limit 1;
        if v_texte is not null then
          raise exception 'La facture reprise % reprendrait la série que l''application a déjà continuée (la facture %) : une facture reprise précède toujours celles de l''application.',
            new.numero, v_texte using errcode = '22023';
        end if;
      end loop;
    end if;
    return new;
  end if;

  -- La validation : le numéro est celui de la série de qui valide (le mandataire posé : le cabinet), pour l'année de la
  -- facture ; et la facture n'est pas datée d'avant la plus récente de sa série, validée ou reprise (CGI, ann. II,
  -- art. 242 nonies A, I, 7° : une séquence chronologique). Le verrou de la série est tenu (`numerotation_suivante`).
  if old.statut = 'brouillon' and new.statut = 'validee' then
    v_annee := extract(year from new.date_emission)::integer;
    select * into v_m
      from public.modele_en_vigueur(new.dossier_id, new.type,
                                    case when new.mandataire_nom is not null then 'mandataire' else 'client' end, v_annee);
    v_motif := public.motif_du_modele(v_m.vigueur_modele, v_m.vigueur_annuel, v_annee);
    if new.numero is null or new.numero !~ v_motif then
      raise exception 'Le numéro % n''est pas de la série où cette facture se valide, celle % : une facture ne se valide que par enregistrer_facture, qui le prend dans la série de qui valide.',
        coalesce(new.numero, '(aucun)'), public.libelle_de_serie(v_m.vigueur_modele, v_m.vigueur_annuel, v_annee) using errcode = '23514';
    end if;
    select f.numero, f.date_emission, f.statut into v_texte, v_date, v_statut
      from public.factures_emises f
     where f.dossier_id = new.dossier_id and f.id <> new.id and f.statut in ('validee', 'importee') and f.numero ~ v_motif
     order by f.date_emission desc, substring(f.numero from v_motif)::numeric desc
     limit 1;
    if new.date_emission < v_date then
      if v_statut = 'importee' then
        raise exception 'La date d''émission, le %, précède celle de % (le %), la plus récente des factures reprises de la même série : les numéros suivent l''ordre des dates d''émission (CGI, ann. II, art. 242 nonies A, I, 7°). Une date du % ou d''après se valide.',
          to_char(new.date_emission, 'DD/MM/YYYY'), v_texte, to_char(v_date, 'DD/MM/YYYY'), to_char(v_date, 'DD/MM/YYYY')
          using errcode = '22023';
      end if;
      raise exception 'La date d''émission, le %, précède celle de % (le %), la plus récente de la même série : les numéros suivent l''ordre des dates d''émission (CGI, ann. II, art. 242 nonies A, I, 7°). Une date du % ou d''après se valide.',
        to_char(new.date_emission, 'DD/MM/YYYY'), v_texte, to_char(v_date, 'DD/MM/YYYY'), to_char(v_date, 'DD/MM/YYYY')
        using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

create trigger factures_emises_numerotation
  before insert or update or delete on public.factures_emises
  for each row execute function public.garder_la_numerotation();

-- La garde des factures reprises d'A8a, sans son cinquième refus étendu (la série lue `^[FA][0-9]{4}-[0-9]+$`) : la
-- chronologie de la série vit désormais dans `garder_la_numerotation`, par le modèle. Le reste à l'identique.
create or replace function public.garder_factures_reprises() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot uuid;
begin
  if tg_op = 'DELETE' then
    if old.statut = 'importee' then
      if not exists (select 1 from public.dossiers where id = old.dossier_id) then
        return old;
      end if;
      select fi.import_id into v_lot from public.factures_importees fi where fi.facture_id = old.id;
      if v_lot is null or coalesce(current_setting('jd.retrait_import', true), '') is distinct from v_lot::text then
        raise exception 'La facture % est reprise de l''ancien logiciel : elle ne se supprime que par le retrait de son import, en entier (retirer_import).',
          old.numero using errcode = '23514';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.statut = 'importee'
       and coalesce(current_setting('jd.import_facture', true), '') is distinct from new.id::text
       and not public.restauration_des_factures(new.dossier_id) then
      raise exception 'Une facture reprise ne naît que par importer_factures, qui la juge.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.statut = 'importee' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'La facture % est reprise de l''ancien logiciel : elle ne se modifie pas. Une reprise fausse se retire en entier (retirer_import), tant que rien ne s''y rattache.',
        old.numero using errcode = '23514';
    end if;
    return new;
  end if;
  if new.statut = 'importee' then
    raise exception 'Une facture ne devient pas une facture reprise : celle-ci naît par importer_factures.' using errcode = '42501';
  end if;
  return new;
end
$$;

-- ══ 7. LES GESTES DU CABINET : LE MODÈLE, LA FIN CONFIRMÉE, LES TROUS LEVÉS ══════════

create function public.fixer_modele_numerotation(p_dossier_id uuid, p_nature text, p_emetteur text, p_modele text,
                                                 p_annuel boolean, p_depuis integer, p_premier_numero integer default 1)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet uuid;
  v_refus text;
  v_autre record;
  v_id uuid;
begin
  -- L'accès, avant toute lecture : le cabinet du dossier, puis son chef seul (A9A-Q2).
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- Le dossier, verrouillé : deux modèles posés ensemble se suivent, et se jugent l'un l'autre.
  select d.cabinet_id into v_cabinet from public.dossiers d where d.id = p_dossier_id for update;
  if not public.est_chef_du_cabinet(v_cabinet) then
    raise exception 'Seul le chef du cabinet pose le modèle de numéro d''un dossier.' using errcode = '42501';
  end if;
  if p_nature is null or p_nature not in ('facture', 'avoir') then
    raise exception 'Un modèle de numéro vaut pour les factures ou pour les avoirs.' using errcode = '22023';
  end if;
  if p_emetteur is null or p_emetteur not in ('client', 'mandataire') then
    raise exception 'Un modèle de numéro vaut pour la série du client (les factures qu''il valide) ou pour celle du cabinet mandataire (celles que le cabinet valide en son nom, DGFiP, annexe 7, G1.45).'
      using errcode = '22023';
  end if;
  if p_annuel is null then
    raise exception 'Un modèle de numéro dit si son compteur repart de 1 chaque année.' using errcode = '22023';
  end if;
  if p_depuis is null or p_depuis not between 2000 and 2099 then
    raise exception 'Un modèle de numéro s''applique à partir d''une année, de 2000 à 2099 (DGFiP, annexe 7, G1.36).'
      using errcode = '22023';
  end if;
  if p_premier_numero is null or p_premier_numero not between 1 and 999999999 then
    raise exception 'Le premier numéro d''une série est un compteur de 1 à 999 999 999.' using errcode = '22023';
  end if;
  v_refus := public.refus_du_modele(p_modele, p_annuel);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;
  -- Ce que le modèle côtoiera, pour chaque année qu'il couvre (la sienne, et celles où un modèle déjà posé change) : le
  -- modèle en vigueur de chaque emplacement — les trois autres, et celui qu'il remplace dans le sien.
  for v_autre in
    with annees as (
      select p_depuis as annee
      union
      select m.depuis from public.modeles_numerotation m where m.dossier_id = p_dossier_id and m.depuis > p_depuis
    )
    select distinct e.nature, e.emetteur, v.vigueur_modele as modele, v.vigueur_annuel as annuel
      from annees a
     cross join (values ('facture', 'client'), ('avoir', 'client'), ('facture', 'mandataire'), ('avoir', 'mandataire'))
                as e(nature, emetteur)
     cross join lateral public.modele_en_vigueur(p_dossier_id, e.nature, e.emetteur, a.annee) v
     order by e.nature, e.emetteur, v.vigueur_modele
  loop
    if v_autre.modele = p_modele and v_autre.annuel = p_annuel
       and (v_autre.emetteur = p_emetteur) then
      -- La même série : le modèle se repose (son premier numéro change), ou les factures et les avoirs d'un même émetteur
      -- partagent leur compteur.
      continue;
    end if;
    if v_autre.modele = p_modele and v_autre.emetteur <> p_emetteur then
      raise exception 'Le modèle % est celui de la série % : la série du cabinet mandataire porte une racine propre, distincte de celle du client (DGFiP, annexe 7, G1.45).',
        p_modele, public.libelle_d_emplacement(v_autre.nature, v_autre.emetteur) using errcode = '22023';
    end if;
    if v_autre.modele = p_modele or public.modeles_se_recouvrent(v_autre.modele, p_modele) then
      if v_autre.nature = p_nature and v_autre.emetteur = p_emetteur then
        raise exception 'Le modèle % recouvre celui qu''il remplace (%) : un même numéro se lirait dans les deux séries. Une nouvelle série porte un préfixe distinct (BOI-TVA-DECLA-30-20-20-10, § 90).',
          p_modele, v_autre.modele using errcode = '22023';
      end if;
      raise exception 'Le modèle % produirait des numéros de la série % (%) : deux séries d''un dossier ne partagent jamais un numéro.',
        p_modele, public.libelle_d_emplacement(v_autre.nature, v_autre.emetteur), v_autre.modele using errcode = '22023';
    end if;
  end loop;
  v_id := gen_random_uuid();
  perform set_config('jd.numerotation', v_id::text, true);
  insert into public.modeles_numerotation (id, dossier_id, nature, emetteur, modele, annuel, depuis, premier_numero, pose_par)
  values (v_id, p_dossier_id, p_nature, p_emetteur, p_modele, p_annuel, p_depuis, p_premier_numero, auth.uid());
  perform set_config('jd.numerotation', '', true);
  return v_id;
end
$$;

comment on function public.fixer_modele_numerotation(uuid, text, text, text, boolean, integer, integer) is
  'Pose le modèle de numéro d''un emplacement d''un dossier (A9a) — nature (facture, avoir), émetteur (client, mandataire), modèle, annuel, depuis (l''année), premier numéro (de l''année depuis) — : le chef du cabinet seul (42501) ; refusé (22023) un modèle que refus_du_modele refuse, ou qui produirait un numéro d''une autre série (le client et le cabinet jamais sous le même modèle, G1.45). Il l''emporte, pour chaque année qu''il couvre, sur ce qui était posé avant. Rend son identifiant.';

-- La série d'un emplacement pour une année, et son jugement : ce que les deux gestes suivants visent.
create function public.confirmer_fin_de_serie(p_dossier_id uuid, p_nature text, p_emetteur text, p_annee integer,
                                              p_dernier integer, p_motif text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet uuid;
  v_m record;
  v_j record;
  v_max_repris numeric;
  v_id uuid;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select d.cabinet_id into v_cabinet from public.dossiers d where d.id = p_dossier_id for update;
  if not public.est_chef_du_cabinet(v_cabinet) then
    raise exception 'Seul le chef du cabinet confirme la fin d''une suite reprise ou lève les trous d''une série.'
      using errcode = '42501';
  end if;
  if p_nature is null or p_nature not in ('facture', 'avoir') or p_emetteur is null or p_emetteur not in ('client', 'mandataire')
     or p_annee is null or p_annee not between 2000 and 2099 then
    raise exception 'Une série se désigne par la nature (facture, avoir), l''émetteur (client, mandataire) et l''année (de 2000 à 2099).'
      using errcode = '22023';
  end if;
  if p_motif is null or btrim(p_motif) = '' or char_length(p_motif) > 1000 then
    raise exception 'Le cabinet écrit ce qui fonde son geste : un motif de 1 000 caractères au plus.' using errcode = '22023';
  end if;
  select * into v_m from public.modele_en_vigueur(p_dossier_id, p_nature, p_emetteur, p_annee);
  select * into v_j from public.jugement_de_la_serie(p_dossier_id, v_m.vigueur_modele, v_m.vigueur_annuel, v_m.vigueur_premier,
                                                     v_m.vigueur_depuis, p_annee);
  if v_j.serie_valides > 0 then
    raise exception 'L''application a déjà continué la série % : la fin de sa suite reprise ne se confirme plus.',
      public.libelle_de_serie(v_m.vigueur_modele, v_m.vigueur_annuel, p_annee) using errcode = '22023';
  end if;
  select max(substring(f.numero from v_j.serie_motif)::numeric) into v_max_repris
    from public.factures_emises f
   where f.dossier_id = p_dossier_id and f.statut = 'importee' and f.numero ~ v_j.serie_motif;
  if p_dernier is null or p_dernier not between greatest(v_j.serie_premier, coalesce(v_max_repris, 1)::integer) and 999999999 then
    raise exception 'La fin de la suite reprise de la série % est le compteur de son dernier numéro, au moins % : le plus haut repris, ou le premier de la série.',
      public.libelle_de_serie(v_m.vigueur_modele, v_m.vigueur_annuel, p_annee),
      greatest(v_j.serie_premier, coalesce(v_max_repris, 1)::integer) using errcode = '22023';
  end if;
  if v_j.serie_fin is not null and p_dernier <= v_j.serie_fin then
    raise exception 'La fin de la suite reprise de la série % est déjà confirmée au numéro % : une fin confirmée ne recule pas.',
      public.libelle_de_serie(v_m.vigueur_modele, v_m.vigueur_annuel, p_annee),
      public.numero_du_modele(v_m.vigueur_modele, p_annee, v_j.serie_fin) using errcode = '22023';
  end if;
  v_id := gen_random_uuid();
  perform set_config('jd.numerotation', v_id::text, true);
  insert into public.continuite_des_series (id, dossier_id, modele, annuel, annee, geste, premier, dernier, motif, pose_par)
  values (v_id, p_dossier_id, v_m.vigueur_modele, v_m.vigueur_annuel, v_j.serie_annee, 'fin', p_dernier, p_dernier,
          btrim(p_motif), auth.uid());
  perform set_config('jd.numerotation', '', true);
  return v_id;
end
$$;

comment on function public.confirmer_fin_de_serie(uuid, text, text, integer, integer, text) is
  'Confirme le dernier numéro que l''ancien logiciel a émis dans la série d''un emplacement pour une année (A9a, A9A-Q3) : son compteur, au moins le plus haut repris, et un motif. Le chef du cabinet seul (42501) ; refusée (22023) quand l''application a déjà continué la série, ou au-dessous d''une fin déjà confirmée. Rend l''identifiant du geste.';

create function public.lever_trous_de_numerotation(p_dossier_id uuid, p_nature text, p_emetteur text, p_annee integer,
                                                   p_premier integer, p_dernier integer, p_motif text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet uuid;
  v_m record;
  v_j record;
  v_id uuid;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select d.cabinet_id into v_cabinet from public.dossiers d where d.id = p_dossier_id for update;
  if not public.est_chef_du_cabinet(v_cabinet) then
    raise exception 'Seul le chef du cabinet confirme la fin d''une suite reprise ou lève les trous d''une série.'
      using errcode = '42501';
  end if;
  if p_nature is null or p_nature not in ('facture', 'avoir') or p_emetteur is null or p_emetteur not in ('client', 'mandataire')
     or p_annee is null or p_annee not between 2000 and 2099 then
    raise exception 'Une série se désigne par la nature (facture, avoir), l''émetteur (client, mandataire) et l''année (de 2000 à 2099).'
      using errcode = '22023';
  end if;
  if p_motif is null or btrim(p_motif) = '' or char_length(p_motif) > 1000 then
    raise exception 'Le cabinet écrit ce qui fonde son geste : un motif de 1 000 caractères au plus.' using errcode = '22023';
  end if;
  select * into v_m from public.modele_en_vigueur(p_dossier_id, p_nature, p_emetteur, p_annee);
  select * into v_j from public.jugement_de_la_serie(p_dossier_id, v_m.vigueur_modele, v_m.vigueur_annuel, v_m.vigueur_premier,
                                                     v_m.vigueur_depuis, p_annee);
  -- Un intervalle de compteurs qui manquent, tout entier dans un trou que rien ne couvre encore.
  if p_premier is null or p_dernier is null or p_dernier < p_premier
     or not exists (select 1 from jsonb_array_elements(v_j.serie_trous) t(v)
                     where (t.v->>0)::numeric <= p_premier and p_dernier <= (t.v->>1)::numeric) then
    raise exception 'Les compteurs % à % ne sont pas un trou de la série % que rien ne couvre encore : seul un numéro qui manque se lève.',
      coalesce(p_premier::text, '?'), coalesce(p_dernier::text, '?'),
      public.libelle_de_serie(v_m.vigueur_modele, v_m.vigueur_annuel, p_annee) using errcode = '22023';
  end if;
  v_id := gen_random_uuid();
  perform set_config('jd.numerotation', v_id::text, true);
  insert into public.continuite_des_series (id, dossier_id, modele, annuel, annee, geste, premier, dernier, motif, pose_par)
  values (v_id, p_dossier_id, v_m.vigueur_modele, v_m.vigueur_annuel, v_j.serie_annee, 'trous', p_premier, p_dernier,
          btrim(p_motif), auth.uid());
  perform set_config('jd.numerotation', '', true);
  return v_id;
end
$$;

comment on function public.lever_trous_de_numerotation(uuid, text, text, integer, integer, integer, text) is
  'Lève, motif écrit, un intervalle de compteurs qui manquent dans la suite reprise de la série d''un emplacement pour une année (A9a) : un numéro « annulé » de l''ancien logiciel, ou émis là et non repris. Le chef du cabinet seul (42501) ; refusée (22023) hors d''un trou que rien ne couvre encore. Rend l''identifiant du geste.';

-- ══ 8. CE QUE LA CARTE DU CABINET DIRA (A9b) ══════════

create function public.etat_de_la_numerotation(p_dossier_id uuid, p_annee integer)
returns table (nature text, emetteur text, modele text, annuel boolean, depuis integer, modele_par_defaut boolean,
               premier integer, emis numeric, importes integer, valides integer, fin integer, trous jsonb, refus text,
               prochain_numero text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_annee is null or p_annee not between 2000 and 2099 then
    raise exception 'L''état de la numérotation se lit pour une année, de 2000 à 2099.' using errcode = '22023';
  end if;
  return query
    select e.nature, e.emetteur, v.vigueur_modele, v.vigueur_annuel, v.vigueur_depuis, v.vigueur_id is null,
           j.serie_premier, j.serie_emis, j.serie_importes, j.serie_valides, j.serie_fin, j.serie_trous, j.serie_refus,
           case when j.serie_refus is null then
             public.numero_du_modele(v.vigueur_modele, p_annee,
               least(greatest(j.serie_prochain, coalesce((select n.dernier_numero + 1 from public.facture_numerotation n
                                                          where n.dossier_id = p_dossier_id and n.annee = j.serie_annee
                                                            and n.type = j.serie_cle), 1)), 999999999)::integer)
           end
      from (values (1, 'facture', 'client'), (2, 'avoir', 'client'), (3, 'facture', 'mandataire'), (4, 'avoir', 'mandataire'))
           as e(rang, nature, emetteur)
     cross join lateral public.modele_en_vigueur(p_dossier_id, e.nature, e.emetteur, p_annee) v
     cross join lateral public.jugement_de_la_serie(p_dossier_id, v.vigueur_modele, v.vigueur_annuel, v.vigueur_premier,
                                                    v.vigueur_depuis, p_annee) j
     order by e.rang;
end
$$;

comment on function public.etat_de_la_numerotation(uuid, integer) is
  'La numérotation d''un dossier pour une année (A9a ; la carte du cabinet, A9b) : par emplacement — factures et avoirs, du client et du cabinet mandataire —, le modèle en vigueur (celui d''hier quand rien n''est posé), le premier numéro, le plus haut compteur de la série, ce qui est repris et validé, la fin confirmée, les trous qui restent ([premier, dernier]), le refus qui retiendrait la prochaine validation, le prochain numéro. Le cabinet du dossier seul (42501).';

-- ══ 9. LES DROITS DES FONCTIONS ══════════

-- Les fonctions pures : la contrainte du modèle appelle `refus_du_modele` sous la session qui écrit (la restauration).
revoke all on function public.refus_du_modele(text, boolean) from public, anon;
grant execute on function public.refus_du_modele(text, boolean) to authenticated, service_role;
revoke all on function public.numero_du_modele(text, integer, integer) from public, anon;
grant execute on function public.numero_du_modele(text, integer, integer) to authenticated, service_role;
revoke all on function public.motif_du_modele(text, boolean, integer) from public, anon;
grant execute on function public.motif_du_modele(text, boolean, integer) to authenticated, service_role;
revoke all on function public.modeles_se_recouvrent(text, text) from public, anon;
grant execute on function public.modeles_se_recouvrent(text, text) to authenticated, service_role;
revoke all on function public.modele_par_defaut(text, text) from public, anon;
grant execute on function public.modele_par_defaut(text, text) to authenticated, service_role;
revoke all on function public.cle_de_serie(text, boolean) from public, anon;
grant execute on function public.cle_de_serie(text, boolean) to authenticated, service_role;
revoke all on function public.libelle_de_serie(text, boolean, integer) from public, anon;
grant execute on function public.libelle_de_serie(text, boolean, integer) to authenticated, service_role;
revoke all on function public.libelle_d_emplacement(text, text) from public, anon;
grant execute on function public.libelle_d_emplacement(text, text) to authenticated, service_role;
-- Les fonctions internes : personne d'autre que leur propriétaire (les fonctions qui les appellent).
revoke all on function public.modele_en_vigueur(uuid, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.serie_d_un_numero(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.jugement_de_la_serie(uuid, text, boolean, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.numerotation_suivante(uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.garder_la_numerotation() from public, anon, authenticated, service_role;
revoke all on function public.garder_tables_de_numerotation() from public, anon, authenticated, service_role;
-- Les gestes du cabinet et sa lecture : une session, le contrôle d'accès en tête de chacune.
revoke all on function public.fixer_modele_numerotation(uuid, text, text, text, boolean, integer, integer) from public, anon, service_role;
grant execute on function public.fixer_modele_numerotation(uuid, text, text, text, boolean, integer, integer) to authenticated;
revoke all on function public.confirmer_fin_de_serie(uuid, text, text, integer, integer, text) from public, anon, service_role;
grant execute on function public.confirmer_fin_de_serie(uuid, text, text, integer, integer, text) to authenticated;
revoke all on function public.lever_trous_de_numerotation(uuid, text, text, integer, integer, integer, text) from public, anon, service_role;
grant execute on function public.lever_trous_de_numerotation(uuid, text, text, integer, integer, integer, text) to authenticated;
revoke all on function public.etat_de_la_numerotation(uuid, integer) from public, anon, service_role;
grant execute on function public.etat_de_la_numerotation(uuid, integer) to authenticated;

-- ══ GARDE DE FIN ══════════

do $fin$
declare
  v_modeles text[] := array['F{AAAA}-{N:4}', 'A{AAAA}-{N:4}', 'M{AAAA}-{N:4}', 'MA{AAAA}-{N:4}'];
begin
  -- Les déclencheurs AVANT de factures_emises, dans l'ordre des noms : la garde d'hier, celle des mentions, celle des
  -- reprises, la marque d'acompte, la numérotation, la source de la vente.
  if (select string_agg(t.tgname, ',' order by t.tgname collate "C")
        from pg_trigger t
       where t.tgrelid = 'public.factures_emises'::regclass and not t.tgisinternal and t.tgname like 'factures_emises_%'
         and (t.tgtype & 2) = 2)
     is distinct from 'factures_emises_figees,factures_emises_figees_mentions,factures_emises_figees_reprises,'
                   || 'factures_emises_marque_d_acompte,factures_emises_numerotation,factures_emises_source_de_la_vente' then
    raise exception 'Les déclencheurs AVANT de factures_emises ne sont pas dans l''ordre attendu.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.modeles_numerotation'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.continuite_des_series'::regclass) then
    raise exception 'La RLS des tables de la numérotation n''est pas active.';
  end if;
  if exists (select 1 from pg_policy p
              where p.polrelid in ('public.modeles_numerotation'::regclass, 'public.continuite_des_series'::regclass)
                and p.polroles <> array[to_regrole('authenticated')]::oid[]) then
    raise exception 'Une policy des tables de la numérotation vise un autre rôle que authenticated.';
  end if;
  if (select count(*) from pg_policy p
       where p.polrelid in ('public.modeles_numerotation'::regclass, 'public.continuite_des_series'::regclass)
         and p.polpermissive and p.polcmd in ('w', 'd', '*')) <> 0 then
    raise exception 'Une policy des tables de la numérotation ouvre une modification ou une suppression.';
  end if;
  -- Les quatre modèles d'hier et du cabinet : reçus, et deux à deux séparés.
  if exists (select 1 from unnest(v_modeles) m where public.refus_du_modele(m, true) is not null)
     or exists (select 1 from unnest(v_modeles) a, unnest(v_modeles) b where a < b and public.modeles_se_recouvrent(a, b)) then
    raise exception 'Les modèles par défaut ne sont pas reçus, ou se recouvrent.';
  end if;
  -- La série d'hier se formate comme hier.
  if public.numero_du_modele('F{AAAA}-{N:4}', 2026, 7) <> public.numero_facture_formate(2026, 'facture', 7)
     or public.numero_du_modele('A{AAAA}-{N:4}', 2026, 12345) <> public.numero_facture_formate(2026, 'avoir', 12345) then
    raise exception 'Le modèle d''hier ne formate plus comme numero_facture_formate.';
  end if;
end
$fin$;

-- Fin de la migration numerotation_continue.
