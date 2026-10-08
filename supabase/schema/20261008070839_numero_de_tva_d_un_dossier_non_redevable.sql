-- LE NUMÉRO DE TVA D'UN DOSSIER EN FRANCHISE OU EXONÉRÉ (ligne 28.5, étape c, quatrième temps ; décision du cabinet du
-- 08/10/2026 : « une case par dossier »). Une facture électronique sans TVA porte le numéro de TVA intracommunautaire
-- du vendeur : la règle G1.47 des spécifications externes de la DGFiP l'exige dès que sa ventilation porte le code E —
-- exonération ou franchise en base —, et la norme EN 16931 (BR-E-02) demande de même un identifiant fiscal du vendeur.
-- Un dossier redevable en a toujours un, que l'application calcule de son SIREN (CGI, art. 286 ter) ; un dossier en
-- franchise ou exonéré n'en a pas toujours : le cabinet dit ici s'il en a un, et le numéro se calcule alors de même.
-- Sans lui, ses factures restent imprimables et envoyables par e-mail, mais ne partent pas par une plateforme.
--
-- Sans objet hors de la franchise et de l'exonération : la base refuse la case sur un autre statut plutôt que de
-- l'effacer en silence quand c'est le statut qu'on change — comme l'article d'exonération —, sauf quand c'est l'ancien
-- booléen `assujetti_tva` qui retire le statut : le déclencheur la retire alors avec lui.
alter table public.dossiers
  add column numero_tva_attribue boolean not null default false;

comment on column public.dossiers.numero_tva_attribue is
  'Un dossier en franchise en base ou exonéré qui a un numéro de TVA intracommunautaire, attribué par son service des '
  'impôts : le numéro se calcule de son SIREN, et ses factures sans TVA peuvent partir par une plateforme (règle G1.47 '
  'de la DGFiP). Sans objet pour un autre statut — un redevable en a toujours un.';

alter table public.dossiers
  -- Le `coalesce`, comme pour l'article : un statut nul rendrait la condition nulle, et une contrainte nulle passe.
  add constraint dossiers_numero_tva_attribue_coherent
    check (not numero_tva_attribue or coalesce(statut_tva in ('franchise', 'exonere'), false));

create or replace function public.deduire_assujetti_tva() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.statut_tva is null then
      if new.assujetti_tva then
        new.statut_tva := 'redevable';
      end if;
    else
      new.assujetti_tva := new.statut_tva = 'redevable';
    end if;
  elsif new.statut_tva is distinct from old.statut_tva then
    new.assujetti_tva := coalesce(new.statut_tva = 'redevable', false);
  elsif new.assujetti_tva is distinct from old.assujetti_tva then
    new.statut_tva := case when new.assujetti_tva then 'redevable' end;
    if new.statut_tva is null then
      new.article_exoneration := null;
    end if;
    -- Redevable ou à préciser, le dossier n'a plus de case à cocher : elle part avec le statut que le booléen retire.
    new.numero_tva_attribue := false;
  end if;
  return new;
end;
$$;
