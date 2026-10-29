-- LE LEURRE DU BANC (outils/leurre/banc.py ; SUR UNE RÉPLIQUE SEULEMENT, par le super-utilisateur) : quatre dossiers
-- « réels » de leurre, aux valeurs FICTIVES et reconnaissables (marqueur LEURRE-7Q3, adresses en example.test, IBAN au
-- code banque 99999, SIREN 9997357x…, montants 7357,3x : les motifs de regles.json) — A et Z dans le cabinet du dossier
-- `test`, aux identifiants le plus petit et le plus grand (un essai qui choisit « un dossier du cabinet » par
-- `order by id` les prend), N dans un cabinet de plus, avec son chef. Chacun : un compte client et son accès, deux pièces
-- (un achat validé, une vente), leurs fichiers au stockage (l'achat plus lourd que la borne du seau), leurs textes OCR,
-- deux mouvements, une catégorie, une écriture, une facture validée et son encaissement, un contact, un article, des
-- paramètres de facturation et leur RIB, une note interne, un commentaire, un e-mail envoyé et une relance, une
-- conversation de l'assistant, une connexion bancaire, une connexion de plateforme, des identifiants Super PDP, un
-- document divers, ses informations. Le reste des tables de dossier : le remplisseur du banc, puis
-- leurre_complement.sql et leurre_facture_zero.sql. V, au plus petit identifiant du cabinet de `test`, est le dossier
-- réel à son premier jour : sa fiche et l'accès de son client, rien d'autre (un essai qui choisit « un dossier sans
-- écritures », « sans connexion »… le prend).
\set ON_ERROR_STOP on
begin;
select set_config('leurre.cabinet_test', (select cabinet_id::text from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24'), false);

insert into auth.users (id, email) values
  ('7e570000-0000-4000-8000-00000000c003', 'chef.leurre-7q3-n@example.test'),
  ('7e570000-0000-4000-8000-0000000c0a01', 'client.leurre-7q3-a@example.test'),
  ('7e570000-0000-4000-8000-0000000c0a02', 'client.leurre-7q3-z@example.test'),
  ('7e570000-0000-4000-8000-0000000c0a03', 'client.leurre-7q3-n@example.test'),
  ('7e570000-0000-4000-8000-0000000c0a00', 'client.leurre-7q3-v@example.test');

insert into cabinets (id, nom, couleur_primaire, logo_storage_path) values
  ('7e570000-0000-4000-8000-00000000ca03', 'LEURRE-7Q3-N Cabinet', '#7e5700', '7e570000-0000-4000-8000-00000000ca03/LEURRE-7Q3-N-logo.png');
insert into cabinet_admins (user_id, cabinet_id, role, email) values
  ('7e570000-0000-4000-8000-00000000c003', '7e570000-0000-4000-8000-00000000ca03', 'comptable_en_chef', 'chef.leurre-7q3-n@example.test');

insert into dossiers (id, nom, siret, contact_nom, contact_email, cabinet_id, adresse, code_naf, libelle_naf,
                      statut_tva, assujetti_tva, article_exoneration, denomination_imprimee, forme_juridique) values
  ('00000000-0000-4000-8000-00000000a001', 'LEURRE-7Q3-A Dossier', '99973573100013', 'LEURRE-7Q3-A Contact',
   'contact.leurre-7q3-a@example.test', current_setting('leurre.cabinet_test')::uuid,
   'LEURRE-7Q3-A 1 rue du Leurre, 99999 Leurreville', '8690E', 'LEURRE-7Q3-A activité', 'exonere', false, 'cgi_261_4_1',
   'LEURRE-7Q3-A EI', '1000'),
  ('fffffff0-0000-4000-8000-00000000a002', 'LEURRE-7Q3-Z Dossier', '99973574900015', 'LEURRE-7Q3-Z Contact',
   'contact.leurre-7q3-z@example.test', current_setting('leurre.cabinet_test')::uuid,
   'LEURRE-7Q3-Z 1 rue du Leurre, 99999 Leurreville', '8690E', 'LEURRE-7Q3-Z activité', 'exonere', false, 'cgi_261_4_1',
   'LEURRE-7Q3-Z EI', '1000'),
  ('7e570000-0000-4000-8000-00000000a003', 'LEURRE-7Q3-N Dossier', '99973575600010', 'LEURRE-7Q3-N Contact',
   'contact.leurre-7q3-n@example.test', '7e570000-0000-4000-8000-00000000ca03',
   'LEURRE-7Q3-N 1 rue du Leurre, 99999 Leurreville', '8690E', 'LEURRE-7Q3-N activité', 'exonere', false, 'cgi_261_4_1',
   'LEURRE-7Q3-N EI', '1000'),
  ('00000000-0000-4000-8000-00000000a000', 'LEURRE-7Q3-V Dossier', '99973576400014', 'LEURRE-7Q3-V Contact',
   'contact.leurre-7q3-v@example.test', current_setting('leurre.cabinet_test')::uuid,
   'LEURRE-7Q3-V 1 rue du Leurre, 99999 Leurreville', '8690E', 'LEURRE-7Q3-V activité', 'exonere', false, 'cgi_261_4_1',
   'LEURRE-7Q3-V EI', '1000');

insert into memberships (user_id, dossier_id, role, email) values
  ('7e570000-0000-4000-8000-0000000c0a01', '00000000-0000-4000-8000-00000000a001', 'client', 'client.leurre-7q3-a@example.test'),
  ('7e570000-0000-4000-8000-0000000c0a02', 'fffffff0-0000-4000-8000-00000000a002', 'client', 'client.leurre-7q3-z@example.test'),
  ('7e570000-0000-4000-8000-0000000c0a03', '7e570000-0000-4000-8000-00000000a003', 'client', 'client.leurre-7q3-n@example.test'),
  ('7e570000-0000-4000-8000-0000000c0a00', '00000000-0000-4000-8000-00000000a000', 'client', 'client.leurre-7q3-v@example.test');

-- Les lignes de chaque dossier, par une table de travail : X, son identifiant, son marqueur, son IBAN, son SIRET, son
-- montant.
create temporary table leurre (x text, h text, pfx text, d uuid, m text, iban text, siret text, montant numeric, chef uuid, client uuid) on commit drop;
insert into leurre values
  ('A', 'a', '00000000', '00000000-0000-4000-8000-00000000a001', 'LEURRE-7Q3-A', 'FR7699999073577357310000158', '99973573100013', 7357.31,
   'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', '7e570000-0000-4000-8000-0000000c0a01'),
  ('Z', 'b', 'fffffff0', 'fffffff0-0000-4000-8000-00000000a002', 'LEURRE-7Q3-Z', 'FR7699999073577357320000276', '99973574900015', 7357.32,
   'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', '7e570000-0000-4000-8000-0000000c0a02'),
  ('N', 'c', '7e57e000', '7e570000-0000-4000-8000-00000000a003', 'LEURRE-7Q3-N', 'FR7699999073577357330000394', '99973575600010', 7357.33,
   '7e570000-0000-4000-8000-00000000c003', '7e570000-0000-4000-8000-0000000c0a03');

insert into pieces (id, dossier_id, uploaded_by, source, storage_path, nom_fichier, date_piece, tiers, montant_ht, montant_tva,
                    montant_ttc, type_piece, statut, notes, storage_hash, confiance)
  select (pfx || '-0000-4000-8000-0000000001' || h || '1')::uuid, d, client, 'upload', d || '/' || m || '-achat.pdf',
         m || '-achat.pdf', '2025-06-17'::date, m || ' Fournisseur', montant, 0, montant, 'achat', 'validee', m || ' notes de la pièce',
         md5(m || 'achat'), 'haute' from leurre
  union all
  select (pfx || '-0000-4000-8000-0000000001' || h || '2')::uuid, d, client, 'email', d || '/' || m || '-vente.pdf',
         m || '-vente.pdf', '2025-06-18'::date, m || ' Patient', montant, 0, montant, 'vente', 'a_valider', m || ' notes de la vente',
         md5(m || 'vente'), 'moyenne' from leurre;

insert into piece_textes_ocr (piece_id, dossier_id, texte)
  select p.id, p.dossier_id, l.m || ' TEXTE OCR — patient ' || l.m || ' Patient, né le 17/06/1975, IBAN ' || l.iban
         || ', montant ' || l.montant || ' EUR'
    from pieces p join leurre l on l.d = p.dossier_id;

insert into storage.objects (bucket_id, name, metadata)
  select 'pieces', p.storage_path,
         jsonb_build_object('size', case when p.type_piece = 'achat' then 25000000 else 1000 end, 'mimetype', 'application/pdf')
    from pieces p join leurre l on l.d = p.dossier_id;
insert into storage.objects (bucket_id, name, metadata) values
  ('cabinet-logos', '7e570000-0000-4000-8000-00000000ca03/LEURRE-7Q3-N-logo.png', '{"size": 600000, "mimetype": "image/png"}'),
  ('pieces', '00000000-0000-4000-8000-00000000a001/LEURRE-7Q3-A-orphelin.pdf', '{"size": 30000000, "mimetype": "application/pdf"}');

insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, source_fichier, libelle_brut, id_externe)
  select (pfx || '-0000-4000-8000-0000000002' || h || '1')::uuid, d, '2025-06-20'::date, m || ' VIR SEPA PATIENT', montant,
         'non_rapprochee', m || '-releve.csv', m || ' VIR SEPA PATIENT BRUT', m || '-ext-1' from leurre
  union all
  select (pfx || '-0000-4000-8000-0000000002' || h || '2')::uuid, d, '2025-06-21'::date, m || ' PRLV FOURNISSEUR', -montant - 889.11,
         'non_rapprochee', m || '-releve.csv', m || ' PRLV FOURNISSEUR BRUT', m || '-ext-2' from leurre;

insert into categories (id, dossier_id, code, libelle, ordre, compte_comptable, poste_2035)
  select (pfx || '-0000-4000-8000-0000000003' || h || '1')::uuid, d, 'leurre_7q3_' || lower(x), m || ' catégorie', 99,
         '606000', null from leurre;

insert into notes_internes (dossier_id, piece_id, texte)
  select d, (pfx || '-0000-4000-8000-0000000001' || h || '1')::uuid, m || ' note interne du cabinet' from leurre;
insert into piece_commentaires (dossier_id, piece_id, auteur_id, origine, texte)
  select d, (pfx || '-0000-4000-8000-0000000001' || h || '1')::uuid, client, 'client', m || ' commentaire du client' from leurre;
insert into informations_dossier (dossier_id, vehicule_type, vehicule_libelle, notes)
  select d, 'aucun', m || ' véhicule', m || ' informations du dossier' from leurre;
insert into agent_conversations (dossier_id, role, texte, created_by)
  select d, 'user', m || ' question posée à l''assistant', chef from leurre;
insert into connexions_bancaires (dossier_id, banque_nom, banque_pays, environnement, etat, session_id, valide_jusqu_au, comptes,
                                  compte_uid, compte_empreinte, created_by)
  select d, m || ' Banque', 'FR', 'SANDBOX', 'active', m || '-session-SECRET', now() + interval '90 days',
         jsonb_build_array(jsonb_build_object('iban', iban, 'nom', m || ' compte')), m || '-uid', md5(m || 'compte'), chef from leurre;
insert into connexions_plateformes (dossier_id, nom, url_flux, url_jeton, client_id, client_secret, organisation_id, portee, created_by)
  select d, m || ' Plateforme', 'https://' || lower(m) || '.example.test/flux', 'https://' || lower(m) || '.example.test/jeton',
         m || '-client-id', m || '-CLIENT-SECRET', m || '-organisation', 'factures', chef from leurre;
insert into superpdp_credentials (dossier_id, client_id, client_secret)
  select d, m || '-pdp-client', m || '-PDP-SECRET' from leurre;
insert into documents_divers (dossier_id, storage_path, nom_fichier, categorie, notes)
  select d, d || '/' || m || '-document.pdf', m || '-document.pdf', 'autre', m || ' notes du document' from leurre;
insert into emails_envoyes (dossier_id, type, destinataire, objet, envoye_par)
  select d, 'relance_pieces', 'client.' || lower(m) || '@example.test', m || ' relance des pièces', chef from leurre;

-- Par les fonctions de la base, sous la session du chef de chaque dossier (le chef du cabinet de `test` est aussi
-- super-administrateur ; celui du cabinet N ne l'est pas).
create temporary table leurre_fait (x text, quoi text, valeur text) on commit drop;
grant select on leurre to authenticated;
grant insert, select on leurre_fait to authenticated;
do $$
declare
  r record;
  v_param uuid;
  v_facture uuid;
begin
  for r in select * from leurre order by x loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.chef, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select p.id into v_param from public.enregistrer_parametres_facturation(r.d, null, jsonb_build_object(
      'delai_paiement_jours', 30, 'moyen_prefere', 'virement', 'escompte', r.m || ' escompte', 'penalites', r.m || ' pénalités',
      'mentions_complementaires', r.m || ' mentions complémentaires', 'pied_de_page', r.m || ' pied de page',
      'iban', r.iban, 'bic', 'LEURFR99', 'titulaire_compte', r.m || ' Titulaire')) p;
    insert into leurre_fait values (r.x, 'parametres', v_param::text);
    insert into leurre_fait select r.x, 'contact', c.id::text from public.enregistrer_contact(r.d, null, jsonb_build_object(
      'nom', r.m || ' Contact client', 'type_client', 'assujetti', 'siren', case r.x when 'A' then '999735764' when 'Z' then '999735772' else '999735780' end, 'adresse', r.m || ' 3 rue du Contact, 99999 Leurreville',
      'email', 'contact.' || lower(r.m) || '@example.test', 'observations', r.m || ' observations')) c;
    insert into leurre_fait select r.x, 'article', a.id::text from public.enregistrer_article(r.d, null, jsonb_build_object(
      'designation', r.m || ' article', 'description', r.m || ' description', 'prix_unitaire_ht', r.montant, 'taux_tva', 0,
      'nature', 'services')) a;
    select f.facture_id into v_facture from public.enregistrer_facture(r.d, null, jsonb_build_object(
      'tiers_nom', r.m || ' Client facturé', 'tiers_adresse', r.m || ' 2 rue du Client, 99999 Leurreville',
      'tiers_email', 'client.facture.' || lower(r.m) || '@example.test', 'type_client', 'non_assujetti',
      'emetteur_nom', r.m || ' EI', 'emetteur_siret', r.siret, 'emetteur_adresse', r.m || ' 1 rue du Leurre, 99999 Leurreville',
      'montant_ht', r.montant, 'montant_tva', 0, 'montant_ttc', r.montant, 'nature_operation', 'services',
      'date_emission', '2025-06-17', 'notes', r.m || ' notes de la facture'),
      jsonb_build_array(jsonb_build_object('designation', r.m || ' prestation de soins', 'quantite', 1,
        'prix_unitaire_ht', r.montant, 'taux_tva', 0)), true) f;
    insert into leurre_fait values (r.x, 'facture', v_facture::text);
    insert into leurre_fait select r.x, 'encaissement', e.id::text from public.enregistrer_encaissement(r.d, v_facture, '2025-06-20',
      r.montant, 'virement', (r.pfx || '-0000-4000-8000-0000000002' || r.h || '1')::uuid,
      jsonb_build_array(jsonb_build_object('taux', 0, 'montant', r.montant))) e;
    reset role;
    insert into emails_envoyes (dossier_id, type, destinataire, objet, facture_id, envoye_par)
      values (r.d, 'facture', 'client.facture.' || lower(r.m) || '@example.test', r.m || ' votre facture', v_facture, r.chef);
  end loop;
end $$;

-- Une écriture du relevé (le prélèvement, sur la catégorie), posée en direct par le propriétaire.
insert into ecritures_brouillon (dossier_id, ligne_bancaire_id, date, compte, libelle, montant, sens)
  select d, (pfx || '-0000-4000-8000-0000000002' || h || '2')::uuid, '2025-06-21'::date, '606000', m || ' écriture du prélèvement',
         montant + 889.11, 'debit' from leurre
  union all
  select d, (pfx || '-0000-4000-8000-0000000002' || h || '2')::uuid, '2025-06-21'::date, '512000', m || ' écriture du prélèvement',
         montant + 889.11, 'credit' from leurre;

select x, quoi, count(*) from leurre_fait group by 1, 2 order by 1, 2;
select 'leurre', count(*) from dossiers where nom like 'LEURRE-7Q3-%';
commit;
