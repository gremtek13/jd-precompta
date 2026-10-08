-- UNE FACTURE REJETÉE OU REFUSÉE S'ANNULE PAR UN AVOIR INTERNE, QUI NE SE TRANSMET PAS (ligne 28.5, étape c,
-- quatrième temps). Les spécifications externes de la DGFiP le disent sous le tableau des statuts d'une facture
-- (§ 3.6.4) : « Dans les cas des statuts Refusée ou Rejetée, le fournisseur doit procéder à une annulation comptable
-- (avoir interne). Cette opération ne doit pas générer de flux de données réglementaires (F1). »
--
-- La table des transmissions admettait une nouvelle transmission après un rejet — les rejets s'accumulaient comme les
-- échecs —, et rien n'empêchait de transmettre l'avoir qui annule une facture rejetée. Le déclencheur refuse désormais
-- les deux : une facture dont une transmission a été rejetée ne repart pas, et un avoir dont la facture d'origine a été
-- rejetée — par une plateforme (une transmission `rejete`) ou, chez Super PDP, par le statut 213 « Rejetée » — ou
-- refusée par l'acheteur (le statut 210 « Refusée », que seul l'historique de Super PDP porte) ne se transmet pas. Un
-- ÉCHEC, lui, n'a rien fait partir : la facture repart après lui, comme avant.
--
-- Le rejet ne compte que s'il PRÉCÈDE la transmission : une restauration rejoue l'historique avec ses dates.
create or replace function public.garder_transmission_facture() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.factures_emises f
                    where f.id = new.facture_id and f.dossier_id = new.dossier_id and f.statut = 'validee') then
      raise exception 'Seule une facture validée de son dossier se transmet.' using errcode = '23514';
    end if;
    if exists (select 1 from public.transmissions_factures r
                where r.facture_id = new.facture_id and r.etat = 'rejete' and r.cree_le <= new.cree_le) then
      raise exception 'Une facture rejetée ne repart pas : elle s''annule par un avoir interne, qui ne se transmet pas, puis une nouvelle facture.'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.factures_emises a
                where a.id = new.facture_id and a.type = 'avoir' and a.facture_origine_id is not null
                  and (exists (select 1 from public.transmissions_factures r
                                where r.facture_id = a.facture_origine_id and r.etat = 'rejete')
                       or exists (select 1 from public.facture_superpdp_events e
                                   where e.facture_id = a.facture_origine_id and e.status_code in ('fr:210', 'fr:213')))) then
      raise exception 'Cet avoir annule une facture rejetée ou refusée : c''est un avoir interne, qui ne se transmet pas.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if new.dossier_id is distinct from old.dossier_id or new.facture_id is distinct from old.facture_id
     or new.canal is distinct from old.canal or new.hote is distinct from old.hote
     or new.sha256 is distinct from old.sha256 or new.cree_le is distinct from old.cree_le then
    raise exception 'Une transmission ne change ni de facture, ni de canal, ni d''hôte, ni de fichier.' using errcode = '23514';
  end if;
  if old.flux_id is not null and new.flux_id is distinct from old.flux_id then
    raise exception 'Le flux d''une transmission ne se renomme pas.' using errcode = '23514';
  end if;
  if old.etat in ('echec', 'accepte', 'rejete') and new.etat <> old.etat
     or old.etat = 'depose' and new.etat in ('envoi', 'echec') then
    raise exception 'Une transmission ne revient pas en arrière : % ne devient pas %.', old.etat, new.etat
      using errcode = '23514';
  end if;
  new.maj_le := now();
  return new;
end
$$;
