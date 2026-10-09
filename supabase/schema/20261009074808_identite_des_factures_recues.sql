-- L'IDENTITÉ D'UNE FACTURE ÉLECTRONIQUE REÇUE, GARDÉE SUR SA PIÈCE (ligne 28.6 de la feuille de route : une vente peut
-- entrer deux fois, la facture émise par l'application et la pièce de vente qui revient de la plateforme).
--
-- Une facture émise par l'application, transmise par la plateforme agréée du client ou par Super PDP, revient comme
-- pièce de vente quand on importe les factures de la plateforme (flux CustomerInvoice) ou qu'on synchronise Super PDP.
-- Une facture émise ne compte elle-même nulle part : les ventes n'entrent que par leurs justificatifs (décision du
-- 28/09/2026). La pièce qui revient est donc LA pièce de la vente, et rien ne la reliait à sa facture : un PDF de la même
-- vente déposé à côté compterait deux fois dans la 2035 et la CA3. Le lien se DÉDUIT, comme le lettrage, de ce qui ne
-- change pas : le flux d'une transmission, l'identifiant Super PDP, ou la MÊME IDENTITÉ — celle que l'administration
-- donne à une facture : son numéro, l'année de sa date d'émission et le SIREN de son fournisseur (spécifications
-- externes de la DGFiP v3.2, annexe 7 v1.9, règle G1.42 ; dossier général, § 3.6.7, note 109). Cette identité, l'import
-- la lit dans l'original structuré (CII, UBL, ou le XML d'un Factur-X : BT-1, BT-2, BT-3 et l'identifiant du vendeur,
-- BT-30 ou BT-31, chemins de l'annexe 1 publique des spécifications), puis la jetait avec le reste de sa lecture : elle
-- se garde désormais sur la pièce, telle que l'original la dit. Rien d'autre que l'import ne la connaît.
--
-- Une pièce DÉPOSÉE (un PDF, un e-mail) n'en a pas : rien ne la relie à sa facture émise sans lire son texte ou
-- rapprocher un montant, une date et un client, ce que le pont s'interdit.
--
-- Données mesurées le 09/10/2026 (comptes seulement) : 6 factures émises validées, aucune transmission, aucune pièce
-- reçue d'une plateforme. Tout ce qui suit est latent.

-- ══ L'identité ══════════
-- Le numéro (BT-1 tel que lu : les blancs ramenés à un seul, 255 caractères au plus, la borne du lecteur), le SIREN du
-- vendeur (tiré de son identifiant légal, sinon de son numéro de TVA français), la date d'émission (BT-2) et la nature que
-- dit le type (BT-3 : une facture ou un avoir). Le numéro porte l'identité, sans lui il n'y en a pas ; les trois autres
-- peuvent manquer à un original, et restent alors inconnus, jamais devinés. Seule une pièce reçue d'une plateforme ou de
-- Super PDP en porte : un dépôt — celui du client compris, que sa policy d'insertion restreint à `source = 'upload'` — ne
-- peut pas se dire la jumelle d'une facture émise.
alter table public.pieces
  add column identite_numero text,
  add column identite_siren_vendeur text,
  add column identite_date date,
  add column identite_nature text;

alter table public.pieces
  add constraint pieces_identite_complete
    check (identite_numero is not null or (identite_siren_vendeur is null and identite_date is null and identite_nature is null)),
  add constraint pieces_identite_numero
    check (length(identite_numero) between 1 and 255 and identite_numero = btrim(identite_numero)),
  add constraint pieces_identite_siren_vendeur check (identite_siren_vendeur ~ '^[0-9]{9}$'),
  add constraint pieces_identite_nature check (identite_nature in ('facture', 'avoir')),
  add constraint pieces_identite_lue check (identite_numero is null or source in ('plateforme', 'superpdp'));

-- ══ La garde ══════════
-- L'identité est ce que l'original DIT : elle ne se corrige pas. La date, le tiers et les montants de la pièce restent
-- ceux que le cabinet arbitre. Aux droits de l'appelant ; elle ne lit rien.
create function public.garder_identite_piece() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.identite_numero, new.identite_siren_vendeur, new.identite_date, new.identite_nature)
     is distinct from (old.identite_numero, old.identite_siren_vendeur, old.identite_date, old.identite_nature) then
    raise exception 'L''identité de la facture électronique d''une pièce ne se modifie pas : c''est ce que son original dit, lu à l''import.'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger pieces_identite_immuable
  before update of identite_numero, identite_siren_vendeur, identite_date, identite_nature on public.pieces
  for each row execute function public.garder_identite_piece();

-- ══ Les droits d'exécution ══════════
-- La garde ne sert qu'au déclencheur.
revoke execute on function public.garder_identite_piece() from public, anon, authenticated;

comment on column public.pieces.identite_numero is
  'Le numéro de la facture électronique reçue (BT-1), tel que son original le dit : avec le SIREN du vendeur et l''année de la date d''émission, l''identité qu''elle a pour l''administration (règle G1.42). Nul pour une pièce déposée.';
comment on column public.pieces.identite_siren_vendeur is
  'Le SIREN du vendeur que l''original désigne (identifiant légal, sinon numéro de TVA français) ; nul s''il ne le dit pas.';
comment on column public.pieces.identite_date is
  'La date d''émission que l''original porte (BT-2) ; la date de la pièce, elle, reste celle que le cabinet arbitre.';
comment on column public.pieces.identite_nature is
  'Ce que dit le type de l''original (BT-3) : facture ou avoir ; nul pour un type inconnu.';
comment on function public.garder_identite_piece() is
  'Garde de l''identité d''une facture électronique reçue : ce que l''original dit ne se modifie pas.';
