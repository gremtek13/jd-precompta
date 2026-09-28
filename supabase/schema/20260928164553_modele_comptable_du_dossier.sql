-- Le modèle comptable d'un dossier : trésorerie (BNC, 2035) ou engagement (BIC, IS), et, en
-- engagement, le compte contre lequel passe une note de frais payée par le dirigeant de sa poche.
alter table public.dossiers
  add column mode_comptable text not null default 'tresorerie',
  add column compte_notes_de_frais text not null default '455000',
  add constraint dossiers_mode_comptable_check check (mode_comptable in ('tresorerie', 'engagement')),
  add constraint dossiers_compte_notes_de_frais_check check (compte_notes_de_frais in ('455000', '108000', '467000'));

comment on column public.dossiers.mode_comptable is
  'Trésorerie (BNC, 2035) : une pièce compte à la date de son paiement. Engagement (BIC, IS) : la facture crée une dette ou une créance à sa date, en 401 ou en 411, et le paiement la solde.';
comment on column public.dossiers.compte_notes_de_frais is
  'En engagement, le compte crédité par une note de frais payée par le dirigeant : 455 compte courant d''associé (dirigeant associé d''une société), 108 compte de l''exploitant (entreprise individuelle), 467 autres comptes débiteurs ou créditeurs (personne non associée, ou aucun compte plus spécifique).';

-- Le modèle se choisit avant la première écriture : il décide des comptes de TOUTES les écritures
-- du dossier, et le changer ensuite laisserait un brouillon à moitié dans l'un, à moitié dans l'autre.
create function public.verrouiller_modele_comptable() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if (new.mode_comptable is distinct from old.mode_comptable
      or new.compte_notes_de_frais is distinct from old.compte_notes_de_frais)
     and exists (select 1 from public.ecritures_brouillon e where e.dossier_id = new.id) then
    raise exception 'Le modèle comptable d''un dossier ne se change que tant que son brouillon d''écritures est vide.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger dossiers_verrouiller_modele_comptable
  before update of mode_comptable, compte_notes_de_frais on public.dossiers
  for each row execute function public.verrouiller_modele_comptable();
