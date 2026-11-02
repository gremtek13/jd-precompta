-- LA FACTURE : LA NUMÉROTATION DANS L'ORDRE DES DATES, LE DEMI-CENTIME D'UNE LIGNE ET LA MENTION DE TVA (correction de la
-- facture du 31/10/2026, avant les premières factures réelles du praticien du MVP, qui les valide lui-même depuis « Mes
-- ventes », MVP-D1 ; reprise le 02/11/2026 pour la réponse du cabinet à FACTURE-Q1 ; HISTORIQUE.md, « LA FACTURE : LA
-- DATE DANS L'ORDRE DE SA SÉRIE, LE DEMI-CENTIME ET LA MENTION DE TVA, REPRISE POUR FACTURE-Q1 (PRÉPARÉE, PAS
-- APPLIQUÉE) »). Préparée sous une version PROVISOIRE, dans supabase/preparees/ ; elle s'applique PAR L'OUTIL : deux
-- fonctions remplacées sous leur nom, aucune table, aucune colonne, aucune donnée, aucun droit, aucune policy touchés —
-- le mot de la suppression n'y paraît que dans `tg_op`, comme dans la garde d'hier, qu'elle recopie.
--
-- POURQUOI. Trois défauts confirmés par une relecture, que la base laissait passer :
--   1. LA NUMÉROTATION SORTAIT DE L'ORDRE DES DATES. `enregistrer_facture` donne le numéro suivant de l'année d'émission
--      sans regarder la date de la facture qui le reçoit : un brouillon daté du 02/12 qui attend, une facture du 05/12
--      validée avant lui (F2026-0001), puis lui (F2026-0002, daté d'avant) — et une date à venir passait aussi. Or la
--      numérotation est « une séquence chronologique et continue » (CGI, ann. II, art. 242 nonies A, I, 7°).
--   2. LE DEMI-CENTIME D'UNE LIGNE TOMBAIT PARFOIS VERS ZÉRO. Le calcul d'une ligne se faisait en virgule flottante, dans
--      l'application (`calculerLigne`) comme ici (`centimes_ligne_facture`, qui le recopiait pour plafonner les
--      encaissements par taux) : 0,5 × 32,05 y donnait 16,02 € au lieu de 16,03 € (16,025 × 100 = 1 602,4999…), 0,5 × 2,01
--      1,00 €, 1,5 × 0,15 0,22 €. Les deux côtés calculent désormais sur les décimaux EXACTS de la ligne — l'application sur
--      l'écriture décimale que la base reçoit, en entiers ; la base en `numeric` —, le demi éloigné de zéro dans les deux
--      sens, et une batterie tirée les confronte (src/lib/montantsFactureBatterie.test.ts).
--   3. UNE FACTURE D'UN DOSSIER EXONÉRÉ OU EN FRANCHISE SE VALIDAIT SANS SA MENTION DE TVA : la base ne jugeait pas le
--      texte des mentions légales. Or la facture d'une opération exonérée cite la disposition qui l'exonère (CGI, ann. II,
--      art. 242 nonies A, I), et celle d'un franchisé l'art. 293 B ; une facture validée ne se corrige que par un avoir.
--
-- CE QU'ELLE CHANGE :
--   - `centimes_ligne_facture`, sous sa signature : le HT au centime sur le produit exact, puis la TVA de ce HT au centime.
--     `montants_par_taux_facture` l'appelle, et avec lui les plafonds des encaissements, les écritures d'une vente
--     facturée et la validation d'un exercice : ils comptent désormais les lignes comme l'application les compte.
--   - `garder_factures_validees` (la garde des factures, déclencheur `factures_emises_figees`), recopiée au caractère près
--     hors de ses quatre variables et du bloc « CE QUE LA VALIDATION EXIGE DE LA FACTURE » : à la validation — que seule
--     `enregistrer_facture` fait, après ses propres refus et après avoir pris le numéro sous le verrou de la série —, cinq
--     refus dans cet ordre, en 22023 : le statut de TVA à préciser (une facture, un accès « Ventes » : FACTURE-Q1) ;
--     l'exonération sans article (une facture, un accès « Ventes » : FACTURE-Q2) ; la mention de TVA absente (une facture
--     ou un avoir, tout auteur, au caractère près : FACTURE-Q3) ; une date à venir ; une date antérieure à la plus récente
--     de la série. Ils viennent après tous ceux d'`enregistrer_facture` et avant ceux de la source de la vente (le
--     déclencheur `factures_emises_source_de_la_vente`, qui la suit dans l'ordre des noms). src/lib/validationDeLaFacture.ts
--     les redit, à leur place et sous leurs mots ; le formulaire de la facture dit avant le clic les deux qui dépendent de
--     l'auteur, selon l'espace.
--
-- LA RÉPONSE DU CABINET (02/11/2026). FACTURE-Q1, contre la recommandation (qui refusait la facture à tout auteur) :
-- « Seulement depuis l'espace client ». Un dossier au statut de TVA à préciser : la facture se refuse à un accès
-- « Ventes » ; le cabinet la valide encore — le patron de l'exonération sans article, qu'`enregistrer_facture` suit aussi
-- pour l'identité légale (A7Q-Q1 : `admin_du_dossier`, le chef, l'équipe affectée et le super-administrateur).
-- FACTURE-Q2 (l'exonération sans article, depuis l'espace client seulement) et FACTURE-Q3 (la mention au caractère près),
-- à la recommandation : ce que le texte du 31/10/2026 écrivait. Les deux refus que seul un accès « Ventes » reçoit
-- parlent au client : ils ne renvoient à aucun onglet du cabinet (lib/espaceVentes.ts, `MOTS_DU_CABINET`).
--
-- CE QU'ELLE NE CHANGE PAS : `enregistrer_facture`, la numérotation, les policies, les droits ; une facture déjà validée,
-- qui garde ses montants enregistrés, ses dates et ses mentions ; la restauration d'une sauvegarde, qui insère des
-- factures validées sans en valider aucune. Ce que la base RECOMPTE d'une facture validée avant elle — ses montants par
-- taux, que rien ne stocke — suit le calcul neuf : une ligne dont le produit tombe exactement sur un demi-centime y
-- gagne le centime que l'arrondi binaire lui ôtait. Aucune facture n'est réelle le 02/11/2026 ; la lecture du jour de
-- l'application (HISTORIQUE.md) dit, par des booléens, si une facture validée en change.
--
-- CE QU'ELLE DÉTRUIT : rien.
--
-- LA GARDE DE TÊTE refuse une base où l'une des deux fonctions n'est pas celle que la production porte le 02/11/2026 — la
-- même que le 31/10/2026 : les quatre migrations appliquées ce jour-là n'y touchent pas — (une seconde application, ou une
-- migration passée depuis) et une base sans les colonnes que la migration `mentions_figees` a posées sur les factures
-- (le statut de TVA et l'article figés).

-- ══ 0. La garde de tête ══════════
do $garde$
declare
  v_fonction record;
begin
  for v_fonction in
    select t.signature, t.empreinte from (values
      ('public.garder_factures_validees()', 'e3dfa6dc1b3f127c66bab26d5637ef89'),
      ('public.centimes_ligne_facture(numeric, numeric, numeric, boolean)', '9b5b63d729df6c0d76f623a15d1e11d9')
    ) as t(signature, empreinte)
    where to_regprocedure(t.signature) is null
       or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure(t.signature)) <> t.empreinte
       or (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname = split_part(substr(t.signature, 8), '(', 1)) <> 1
  loop
    raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %) : la relire avant de l''appliquer.',
      v_fonction.signature, v_fonction.empreinte;
  end loop;
  if (select count(*) from pg_attribute a
       where a.attrelid = 'public.factures_emises'::regclass and not a.attisdropped
         and a.attname in ('statut_tva', 'article_exoneration', 'mentions_figees')) <> 3 then
    raise exception 'La migration mentions_figees (le statut de TVA et l''article que la facture fige) n''est pas en base : cette migration la suppose.';
  end if;
end
$garde$;

-- ══ 1. Le HT et la TVA d'une ligne, sur ses décimaux exacts ══════════
-- Le calcul de `calculerLigne` (src/lib/montantsFacture.ts), qui le fait en entiers sur l'écriture décimale que la base
-- reçoit : le HT, quantité × prix, au centime ; la TVA, HT × taux, au centime ; le demi éloigné de zéro dans les deux
-- sens. La ligne se lit dans le sens du document, comme `montantsDuDocument` (src/lib/factureCii.ts) la lit. Hier, ce
-- calcul recopiait la virgule flottante du navigateur, au bit près — c'était son défaut, que l'application corrige avec
-- lui. src/lib/montantsFactureBatterie.test.ts confronte les deux sur une batterie tirée, relevée ici.
create or replace function public.centimes_ligne_facture(
  p_quantite numeric, p_prix_unitaire_ht numeric, p_taux_tva numeric, p_avoir boolean)
returns table (ht_centimes bigint, tva_centimes bigint)
language plpgsql
immutable
set search_path = public
as $$
declare
  q numeric := p_quantite;
  p numeric := p_prix_unitaire_ht;
begin
  -- La ligne dans le sens du document : un avoir se lit en montants positifs (type 381), une remise saisie à prix
  -- négatif se transmet en quantité négative au même produit.
  if p_avoir then
    q := -q;
  end if;
  if p < 0 then
    q := -q;
    p := -p;
  end if;
  -- Le HT au centime, sur le produit EXACT de la quantité et du prix : `round` d'un `numeric` arrondit le demi loin de
  -- zéro, dans les deux sens (0,5 × 32,05 = 16,025 : 1 603 centimes ; -0,125 : -13).
  ht_centimes := round(q * p * 100);
  -- La TVA de ce HT, au centime, de même : le produit par 0,01 reste exact, là où une division s'arrondirait à son échelle.
  tva_centimes := round(ht_centimes * p_taux_tva * 0.01);
  return next;
end
$$;

comment on function public.centimes_ligne_facture(numeric, numeric, numeric, boolean) is
  'HT et TVA d''une ligne de facture en centimes, comme calculerLigne et montantsDuDocument : sur les décimaux exacts de la ligne (numeric), le HT au centime, puis la TVA de ce HT au centime, le demi éloigné de zéro dans les deux sens (correction de la facture, 31/10/2026).';

-- ══ 2. La garde des factures : ce que la validation exige ══════════
-- Recopiée de la migration factures_validees_figees au caractère près, hors de ses quatre variables et du bloc que son
-- commentaire annonce : la place de ces refus est écrite ici, après la légitimité de la validation, et non tenue par le
-- nom d'un déclencheur de plus.
create or replace function public.garder_factures_validees() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Ce que l'envoi d'une facture validée écrit après coup. Une colonne qu'une étape suivante écrira sur une facture
  -- validée (le dépôt chez la plateforme du client) s'inscrit ici, dans sa migration : facturesFigees.test.ts compare
  -- cette liste à ce que les Edge Functions et l'application écrivent.
  v_modifiables constant text[] := array['tiers_email', 'superpdp_invoice_id', 'superpdp_dernier_statut'];
  -- Correction de la facture (31/10/2026) : ce que la validation exige.
  v_mention text;
  v_aujourdhui date;
  v_numero_suivi text;
  v_date_suivie date;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return old;
    end if;
    if old.statut = 'validee' then
      raise exception 'La facture % est validée : elle ne se supprime plus — la corriger passe par un avoir.', old.numero
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.dossier_id is distinct from old.dossier_id then
      raise exception 'Une facture ne change pas de dossier.' using errcode = '23514';
    end if;
    if old.statut = 'validee' then
      -- Le second passage d'une restauration repose le lien d'un avoir vers sa facture, et rien d'autre.
      if old.type = 'avoir' and old.facture_origine_id is null and new.facture_origine_id is not null
         and to_jsonb(new) - 'facture_origine_id' = to_jsonb(old) - 'facture_origine_id'
         and public.restauration_des_factures(old.dossier_id) then
        return new;
      end if;
      if to_jsonb(new) - v_modifiables is distinct from to_jsonb(old) - v_modifiables then
        raise exception 'La facture % est validée : elle ne se modifie plus — la corriger passe par un avoir.', old.numero
          using errcode = '23514';
      end if;
      return new;
    end if;
    if new.type is distinct from old.type or new.facture_origine_id is distinct from old.facture_origine_id then
      raise exception 'Une facture ne devient pas un avoir : un avoir se crée par enregistrer_facture, qui le valide aussitôt.'
        using errcode = '42501';
    end if;
    if new.statut = 'validee'
       and coalesce(current_setting('jd.validation_facture', true), '') is distinct from new.id::text then
      raise exception 'Une facture ne se valide que par enregistrer_facture, qui lui donne son numéro.'
        using errcode = '42501';
    end if;
    -- CE QUE LA VALIDATION EXIGE DE LA FACTURE (correction de la facture, 31/10/2026). Sa légitimité établie — le réglage
    -- annonce CETTE facture : `enregistrer_facture` la valide, après ses propres refus, et vient de prendre son numéro
    -- sous le verrou de sa série (`prochain_numero_facture`), tenu jusqu'à la fin de la transaction —, la facture se juge
    -- telle que cette écriture la fige : le statut de TVA et l'article qu'elle fige (ceux du dossier, ou, pour un avoir,
    -- ceux de sa facture), ses mentions légales, sa date d'émission et son numéro. Dans cet ordre, en 22023, sous les
    -- mots que src/lib/validationDeLaFacture.ts redit avant le clic :
    --   1. une facture d'un dossier au statut de TVA à préciser, pour un accès « Ventes » : la mention de TVA et le numéro
    --      de TVA qu'elle imprime en dépendent, et une facture validée ne se corrige que par un avoir ; le cabinet la
    --      valide encore (FACTURE-Q1, la réponse du cabinet du 02/11/2026 : « seulement depuis l'espace client »). Un
    --      avoir n'en est pas jugé : il défait une facture telle qu'elle a été faite, et cette voie reste toujours ouverte ;
    --   2. une facture d'un dossier exonéré sans article d'exonération, pour un accès « Ventes » (FACTURE-Q2) : la mention
    --      qu'elle porte en dépend, et le cabinet seul choisit l'article (onglet TVA) ; le cabinet, qui saisit à la main la
    --      mention d'un article hors de la liste, valide encore. Ces deux refus ne parviennent qu'au client : leurs mots
    --      ne renvoient à aucun onglet ;
    --   3. des mentions légales sans la mention de TVA de ce statut, d'une facture comme d'un avoir, pour tout auteur, au
    --      caractère près : « TVA non applicable, art. 293 B du CGI. » en franchise en base (CGI, art. 293 B), la
    --      disposition qui exonère pour un dossier exonéré (CGI, ann. II, art. 242 nonies A, I) — les textes de
    --      `mentionTva` (src/lib/statutTva.ts), que validationDeLaFacture.test.ts confronte à ceux-ci ;
    --   4. une date d'émission à venir, après le jour de Paris ;
    --   5. une date d'émission antérieure à la plus récente des factures validées de sa série — même dossier, même lettre,
    --      même année : un numéro n'est jamais daté d'avant celui qui le précède (CGI, ann. II, art. 242 nonies A, I, 7° :
    --      « une séquence chronologique et continue »). Le verrou de la série est tenu : deux validations concurrentes
    --      se suivent, et la seconde lit la date de la première.
    -- La restauration n'y passe pas : elle insère des factures validées, elle n'en valide aucune.
    if new.statut = 'validee' then
      if new.type = 'facture' and new.statut_tva is null
         and not public.admin_du_dossier(new.dossier_id) then
        raise exception 'Le statut de TVA du dossier est à préciser : la mention de TVA et le numéro de TVA qu''une facture imprime en dépendent. Le cabinet le précise avant qu''une facture se valide depuis l''espace client.'
          using errcode = '22023';
      end if;
      if new.type = 'facture' and new.statut_tva = 'exonere' and new.article_exoneration is null
         and not public.admin_du_dossier(new.dossier_id) then
        raise exception 'Le dossier est exonéré de TVA sans article d''exonération : la mention qu''une facture porte en dépend. Le cabinet choisit l''article avant qu''une facture se valide depuis l''espace client.'
          using errcode = '22023';
      end if;
      v_mention := case
        when new.statut_tva = 'franchise' then 'TVA non applicable, art. 293 B du CGI.'
        when new.statut_tva = 'exonere' then case new.article_exoneration
          when 'cgi_261_4_1' then 'Exonération de TVA, art. 261, 4, 1° du CGI.'
          when 'cgi_261_4_4_a' then 'Exonération de TVA, art. 261, 4, 4° a du CGI.'
          when 'cgi_261_4_4_b' then 'Exonération de TVA, art. 261, 4, 4° b du CGI.'
          when 'cgi_261_c_2' then 'Exonération de TVA, art. 261 C, 2° du CGI.'
        end
      end;
      if v_mention is not null and strpos(coalesce(new.mentions_legales, ''), v_mention) = 0 then
        raise exception 'Les mentions légales ne portent pas la mention de TVA du dossier, « % » : une facture ou un avoir qui ne facture pas de TVA la porte telle quelle (CGI, ann. II, art. 242 nonies A, I ; art. 293 B pour la franchise en base).',
          v_mention using errcode = '22023';
      end if;
      v_aujourdhui := (now() at time zone 'Europe/Paris')::date;
      if new.date_emission > v_aujourdhui then
        raise exception 'La date d''émission, le %, est à venir : nous sommes le % à Paris. Une facture ou un avoir se valide daté du jour au plus tard, sa numérotation suivant l''ordre des dates d''émission (CGI, ann. II, art. 242 nonies A, I, 7°).',
          to_char(new.date_emission, 'DD/MM/YYYY'), to_char(v_aujourdhui, 'DD/MM/YYYY') using errcode = '22023';
      end if;
      select f.numero, f.date_emission into v_numero_suivi, v_date_suivie
        from public.factures_emises f
       where f.dossier_id = new.dossier_id and f.id <> new.id and f.statut = 'validee'
         and split_part(f.numero, '-', 1) = split_part(new.numero, '-', 1)
       order by f.date_emission desc, split_part(f.numero, '-', 2)::integer desc
       limit 1;
      if new.date_emission < v_date_suivie then
        raise exception 'La date d''émission, le %, précède celle de % (le %), la plus récente de la même série : les numéros suivent l''ordre des dates d''émission (CGI, ann. II, art. 242 nonies A, I, 7°). Une date du % ou d''après se valide.',
          to_char(new.date_emission, 'DD/MM/YYYY'), v_numero_suivi, to_char(v_date_suivie, 'DD/MM/YYYY'),
          to_char(v_date_suivie, 'DD/MM/YYYY') using errcode = '22023';
      end if;
    end if;
    return new;
  end if;

  if new.statut = 'validee' and not public.restauration_des_factures(new.dossier_id) then
    raise exception 'Une facture ne naît pas validée : elle se valide par enregistrer_facture, qui lui donne son numéro.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.garder_factures_validees() is
  'Une facture validée ne se modifie ni ne se supprime ; elle ne se valide que par enregistrer_facture (déclencheur factures_emises_figees), et, depuis la correction de la facture (31/10/2026, reprise pour FACTURE-Q1), avec sa mention de TVA, une date d''émission qui n''est pas à venir et qui ne précède pas la plus récente de sa série, et, depuis l''espace client, le statut de TVA de son dossier et, exonéré, son article.';
