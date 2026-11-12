-- LA FIN DE L'IDENTIFIANT D'UN COMPTE BANCAIRE (ligne 26.6, lot MCB2 : l'import d'un relevé par compte). PRÉPARÉE le
-- 11/11/2026, pas appliquée ; elle suit `comptes_bancaires` (MCB1), préparée elle aussi, et s'applique avec elle, juste
-- après : l'application lit l'une et l'autre derrière le même drapeau (`COMPTES_BANCAIRES_PREVUS`). Le récit : HISTORIQUE.md,
-- « 11/11/2026 — L'IMPORT D'UN RELEVÉ PAR COMPTE BANCAIRE (MCB2) ». Son essai : supabase/essais/finDIdentifiantDesComptes.sql ;
-- son retour (DESTRUCTIF) : supabase/preparees/retour/20261111153100_retour_fin_d_identifiant_des_comptes_bancaires.sql ;
-- son module : src/lib/importParCompte.ts.
--
-- Un relevé OFX dit le compte qu'il décrit (ACCTID) ; la table des comptes, elle, ne tient aucun numéro de compte (la
-- conception de MCB l'a écarté : le libellé est un texte libre que le client « Banque » lit). Pour qu'un OFX importé sous
-- le mauvais compte se refuse avant le clic, chaque compte retient les QUATRE DERNIERS caractères de l'identifiant du
-- premier relevé OFX importé sous lui — ce qu'un relevé de banque montre déjà (« compte •••• 4567 »), jamais le numéro
-- entier. Nulle tant qu'aucun OFX n'est importé sous le compte, posée par l'import (le cabinet seul : la policy du cabinet
-- de MCB1), modifiable par le cabinet (une banque qui change la forme de ses identifiants ne doit pas fermer l'import), lue
-- par le client « Banque » comme le reste de la ligne (MCB-Q8) : c'est la fin du numéro de son propre compte.
-- Rien n'est retiré, aucune policy n'est touchée, aucune fonction n'est créée.

do $garde$
begin
  if to_regclass('public.comptes_bancaires') is null then
    raise exception 'La migration comptes_bancaires (MCB1) n''est pas en base : celle-ci la suit.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'comptes_bancaires' and column_name = 'fin_d_identifiant') then
    raise exception 'La migration fin_d_identifiant_des_comptes_bancaires est déjà en base : elle ne s''applique pas deux fois.';
  end if;
end
$garde$;

alter table public.comptes_bancaires
  add column fin_d_identifiant text
    constraint comptes_bancaires_fin_d_identifiant check (fin_d_identifiant ~ '^[0-9A-Z]{4}$');

comment on column public.comptes_bancaires.fin_d_identifiant is
  'Les quatre derniers caractères (chiffres et capitales) de l''identifiant de compte (ACCTID) du premier relevé OFX importé sous ce compte : un OFX qui en porte d''autres se refuse sous lui. Nulle tant qu''aucun OFX n''y est importé ; jamais le numéro entier.';
