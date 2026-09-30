-- L'ESPACE DE CONNEXION À LA BANQUE : professionnel (`business`) ou particulier (`personal`). Un
-- professionnel libéral tient souvent son compte professionnel derrière l'espace PARTICULIER de sa banque,
-- et une banque n'offre pas toujours les deux : le choix se fait à la connexion, parmi ceux que la banque
-- propose. Il est RETENU parce que le renouvellement de l'accord doit repasser par le même espace — sinon
-- la banque ouvre d'autres comptes, et celui qu'on importait n'y est plus.
alter table public.connexions_bancaires add column type_acces text not null default 'business';

alter table public.connexions_bancaires add constraint connexions_bancaires_type_acces
  check (type_acces in ('business', 'personal'));

comment on column public.connexions_bancaires.type_acces is
  'Espace de connexion à la banque choisi à la connexion (business : professionnel, personal : particulier), '
  'repris au renouvellement de l''accord.';
