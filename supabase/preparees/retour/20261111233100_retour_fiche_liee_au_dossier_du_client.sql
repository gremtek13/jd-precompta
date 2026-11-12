-- RETOUR DE LM3 (`fiche_liee_au_dossier_du_client`, 20261112140920) : rend la base d'avant, `signature.sql` égale à
-- celle d'avant la migration (neuf familles). À COLLER (il retire trois colonnes, deux gardes, une lecture, le
-- déliement et six contraintes, et remet le `not null` de `contacts.nom`), AVANT le retour de LM1.
-- La migration est en production depuis le 12/11/2026 (version 20261112140920) : supabase/schema/20261112140920_fiche_liee_au_dossier_du_client.sql.
--
-- CE QU'IL DÉTRUIT : la colonne `contacts.dossier_client_id`, c'est-à-dire le lien de chaque fiche du dossier du cabinet
-- au dossier de son client. Une fiche liée n'a aucune identité à elle (ni nom, ni adresse) : sans son lien, elle ne
-- dirait plus rien, et le `not null` du nom la refuserait. Il se refuse donc tant qu'une fiche est liée : le cabinet les
-- efface d'abord (`effacer_contact`, qui vide le lien), ou les réécrit en fiches à la main après avoir relu leur
-- identité. Une fiche effacée, qui n'a plus de lien, reste telle quelle. Les factures déjà faites gardent leur copie.
-- Il détruit aussi la trace des déliements (`contacts.delie_le`, `delie_par`, LM3-Q1 (B)) : une fiche déliée reste une
-- fiche saisie à la main, son identité recopiée gardée, sans plus dire qui l'a déliée ni quand.
do $garde$
begin
  if not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = 'contacts' and c.column_name = 'dossier_client_id') then
    raise exception 'La fiche liée au dossier du client n''est pas en base : rien à retirer.';
  end if;
  if exists (select 1 from public.contacts f where f.dossier_client_id is not null) then
    raise exception 'Des fiches du dossier du cabinet sont liées aux dossiers de leurs clients : le retour perdrait leur lien, et elles n''ont aucune identité à elles. Les effacer ou les réécrire d''abord.';
  end if;
end
$garde$;

drop trigger cabinets_designation_des_fiches_liees on public.cabinets;
drop function public.garder_designation_des_fiches_liees();
drop trigger contacts_fiche_liee on public.contacts;
drop function public.garder_fiche_liee();
drop function public.identites_des_fiches_liees(uuid);
drop function public.delier_fiche_liee(uuid, uuid, timestamptz);
alter table public.contacts
  drop constraint contacts_delie_sans_lien,
  drop constraint contacts_deliement_entier,
  drop constraint contacts_une_fiche_par_dossier_client,
  drop constraint contacts_efface_delie,
  drop constraint contacts_fiche_liee_sans_identite,
  drop constraint contacts_nom_present,
  drop constraint contacts_vivant_complet,
  drop constraint contacts_adresse_electronique_routee;
alter table public.contacts
  add constraint contacts_adresse_electronique_routee
    check (adresse_electronique is null or coalesce(type_client in ('assujetti', 'organisme_public'), false)),
  add constraint contacts_vivant_complet check (efface_le is not null or (type_client is not null and adresse is not null));
alter table public.contacts alter column nom set not null;
alter table public.contacts drop column dossier_client_id;
alter table public.contacts drop column delie_le, drop column delie_par;

-- Les deux fonctions, à leur corps de production (migration `contacts`, 20261015070431), à l'octet.
create or replace function public.enregistrer_contact(p_dossier_id uuid, p_contact_id uuid, p_contact jsonb)
returns public.contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existant public.contacts;
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
  select coalesce(d.article_exoneration = 'cgi_261_4_1', false) into v_soins from public.dossiers d where d.id = p_dossier_id;
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
                                 code_service, email, delai_paiement_jours, observations, cree_par)
    values (p_dossier_id, 'client', v_type, v_nom, v_adresse, v_siren, v_siret, v_adresse_electronique,
            v_code_service, v_email, v_delai, v_observations, auth.uid())
    returning * into v_ecrit;
  else
    update public.contacts c
       set type_client = v_type, nom = v_nom, adresse = v_adresse, siren = v_siren, siret = v_siret,
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
         efface_le = now(), efface_par = auth.uid()
   where c.id = p_contact_id
  returning * into v_contact;
  return v_contact;
end
$$;

comment on function public.enregistrer_contact(uuid, uuid, jsonb) is
  'Crée ou réécrit un contact du dossier, pour le cabinet ou le client qui porte la case « Ventes » : l''accès d''abord, puis onze rangs de refus dans un ordre fixé, la règle des soins comprise ; rend le contact écrit.';
