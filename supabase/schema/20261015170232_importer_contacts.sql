-- L'IMPORT D'UN FICHIER DE CLIENTS, EN BASE (espace client, étape A4b3a ; ligne 51.5 ; conception : HISTORIQUE.md,
-- « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.4, « L'usage » :
-- « Importer mes contacts » — un aperçu, ligne par ligne, avec les refus de la fonction redits ; rien ne s'écrit avant le
-- clic, et tout ou rien). Présentée au cabinet avant d'être appliquée : elle OUVRE au client qui porte la case « Ventes »
-- un geste nouveau, importer — ranger d'un coup les lignes d'un fichier dans le fichier des clients de son dossier
-- (CLAUDE.md, « Contraintes de sécurité et RGPD »).
--
-- TOUT OU RIEN, ET AUCUNE RÈGLE RECOPIÉE. Aucun appel du navigateur n'ouvre une transaction sur plusieurs appels : l'import
-- est donc UNE fonction, `importer_contacts(p_dossier_id, p_contacts)`, qui range chaque ligne par `enregistrer_contact`
-- ELLE-MÊME, dans l'ordre du fichier et dans la même transaction. Les refus d'un contact sont ceux de cette fonction, sous
-- ses mots et son code, précédés du numéro de la ligne (« Ligne 3 : … ») ; le premier annule TOUT, aucune ligne n'est
-- rangée. Ce que cela suppose, éprouvé sur une réplique de la production avant d'être écrit :
--   - le compte de chaque contact est celui de qui importe : `auth.uid()` se lit dans la session (le réglage
--     `request.jwt.claims`), pas dans le propriétaire de la fonction, et une fonction SECURITY DEFINER appelée par une autre
--     le lit de même — chaque contact est signé de son importateur ;
--   - le verrou du dossier qu'`enregistrer_contact` prend à chaque ligne se REPREND sans attendre par la transaction qui le
--     tient déjà (un verrou consultatif de transaction), et il est gardé jusqu'à la fin de l'import : une autre écriture
--     de contact du même dossier attend que l'import finisse, puis voit ses SIRET ;
--   - le SIRET d'une ligne déjà rangée par le même import compte pour la suivante : il est écrit quand elle se juge, et
--     `enregistrer_contact` le refuse en nommant le contact de la ligne qui le porte (23505).
--
-- CE QU'ELLE NE FAIT PAS. Elle CRÉE seulement : elle ne modifie, ne retire, ne reprend ni n'efface jamais un contact ; une
-- ligne ne désigne aucun contact existant (l'identifiant n'est pas un champ d'une ligne), et un SIRET déjà porté se refuse
-- comme `enregistrer_contact` le refuse. Elle ne lit aucun fichier : l'écran (étape A4b3b) lit le CSV, fait choisir ses
-- colonnes, montre l'aperçu et redit les refus ligne par ligne avant le clic (src/lib/contactsImport.ts), et n'envoie que
-- des objets aux champs d'un contact. Elle ne garde rien de l'import à part — ni lot, ni fichier, ni colonne écartée — :
-- ses contacts portent le même auteur et le même instant de création (`now()` est celui de la transaction), qui suffisent
-- à le reconnaître. Aucune table, aucune policy, aucune fonction d'hier n'est modifiée ; aucune donnée
-- n'est lue, écrite ni retirée par la migration ; aucun écran, aucune Edge Function. Le texte ne porte aucune instruction
-- qui retire quoi que ce soit : `apply_migration` le prend ; le retour arrière est donné à part.
--
-- LES REFUS, dans cet ordre — src/lib/contactsImport.ts les redit avant le clic, dans le même ordre et sous les mêmes mots :
--   1. l'accès au dossier annoncé — le cabinet ou le client « Ventes », `gere_les_ventes` —, et qu'il existe, avant de rien
--      lire : « Accès refusé à ce dossier. » (42501), les mots d'`enregistrer_contact` ;
--   2. l'import : un tableau JSON, d'au moins une ligne, de mille lignes au plus (22023 ; la borne : A4B3-Q1) ;
--   3. ligne par ligne, dans l'ordre du fichier, chaque refus précédé de « Ligne N : » (N compté depuis 1, dans le tableau
--      reçu) : la ligne est un objet JSON (22023) ; ses champs sont ceux qu'`enregistrer_contact` lit — une clé inconnue se
--      refuse, nommée (22023) : `enregistrer_contact` l'ignorerait, et l'import réussirait en perdant en silence une
--      colonne que l'écran a fait correspondre (une faute de frappe, ou un champ que le modèle refuse à dessein, comme un
--      téléphone) ; une clé absente vaut nul, comme pour `enregistrer_contact` — un fichier n'a pas toutes les colonnes,
--      et ce qui est obligatoire (le nom, l'adresse, le type) se refuse là, sous ses propres mots ; puis les refus
--      d'`enregistrer_contact`, sous ses mots et son code (22023, ou 23505 pour un SIRET déjà porté).
--
-- CE QU'ELLE SUPPOSE : la migration `contacts` (étape A4a) ; son premier bloc le vérifie.

-- ══ 0. La migration des contacts d'abord ══════════
do $garde$
begin
  if to_regprocedure('public.enregistrer_contact(uuid, uuid, jsonb)') is null
     or to_regprocedure('public.gere_les_ventes(uuid)') is null then
    raise exception 'La migration contacts (étape A4a) n''est pas en base : l''appliquer d''abord, puis celle-ci.';
  end if;
end
$garde$;

-- ══ 1. Importer des contacts ══════════
-- Rend les identifiants des contacts créés, dans l'ordre du fichier.
create function public.importer_contacts(p_dossier_id uuid, p_contacts jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ligne int := 0;
  v_contact jsonb;
  v_cle text;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_message text;
  v_code text;
begin
  -- 1. L'accès, avant de rien lire ; les mots et le code d'`enregistrer_contact`.
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  -- 2. L'import : un tableau JSON, d'au moins une ligne, de mille lignes au plus (A4B3-Q1).
  if jsonb_typeof(p_contacts) is distinct from 'array' then
    raise exception 'Un import de contacts est un tableau JSON de lignes.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_contacts) = 0 then
    raise exception 'L''import ne porte aucune ligne.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_contacts) > 1000 then
    raise exception 'Un import range mille lignes au plus ; celui-ci en porte % : le partager en plusieurs fichiers.',
      jsonb_array_length(p_contacts) using errcode = '22023';
  end if;

  -- 3. Ligne par ligne, dans l'ordre du fichier. Un seul bloc d'exception pour toutes : une seule sous-transaction ; le
  -- numéro de la ligne en cours survit au refus, qui repart préfixé, sous son code, et le premier refus annule tout. Le
  -- délai d'une instruction (57014) n'est pas un refus : `others` ne l'attrape pas, il repart tel quel, et tout est défait
  -- de même.
  begin
    for i in 1 .. jsonb_array_length(p_contacts) loop
      v_ligne := i;
      v_contact := p_contacts -> (i - 1);
      if jsonb_typeof(v_contact) is distinct from 'object' then
        raise exception 'Une ligne de l''import est un objet JSON aux champs d''un contact.' using errcode = '22023';
      end if;
      -- Les champs qu'`enregistrer_contact` lit. La première clé inconnue se nomme dans l'ordre des OCTETS (« C ») : la
      -- production n'est pas en « C », et le module (src/lib/contactsImport.ts) la nomme dans l'ordre des points de code,
      -- le même.
      select min(k collate "C") into v_cle from jsonb_object_keys(v_contact) as k
       where k not in ('nom', 'adresse', 'type_client', 'siren', 'siret', 'adresse_electronique', 'code_service', 'email',
                       'delai_paiement_jours', 'observations');
      if v_cle is not null then
        raise exception '« % » n''est pas un champ d''un contact.',
          case when char_length(v_cle) > 80 then left(v_cle, 79) || '…' else v_cle end using errcode = '22023';
      end if;
      select c.id into v_id from public.enregistrer_contact(p_dossier_id, null, v_contact) c;
      v_ids := v_ids || v_id;
    end loop;
  exception when others then
    get stacked diagnostics v_message = message_text, v_code = returned_sqlstate;
    raise exception 'Ligne % : %', v_ligne, v_message using errcode = v_code;
  end;
  return v_ids;
end
$$;

-- ══ 2. Les droits d'exécution ══════════
-- Elle vérifie l'accès elle-même ; un anonyme n'a rien à y faire.
revoke execute on function public.importer_contacts(uuid, jsonb) from public, anon;
grant execute on function public.importer_contacts(uuid, jsonb) to authenticated;

comment on function public.importer_contacts(uuid, jsonb) is
  'Range d''un coup les lignes d''un import dans les contacts du dossier, pour le cabinet ou le client qui porte la case « Ventes » : chaque ligne par enregistrer_contact, dans l''ordre, tout ou rien ; le premier refus dit sa ligne (« Ligne N : ») et annule tout. Crée seulement ; rend les identifiants créés, dans l''ordre.';
