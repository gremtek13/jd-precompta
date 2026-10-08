-- L'ABANDON D'UNE TRANSMISSION DONT L'ISSUE EST RESTÉE INCONNUE (ligne 28.5, étape c, quatrième temps).
--
-- Une transmission part `envoi` et le reste quand la plateforme n'a pas répondu lisiblement — pas de réponse, une
-- réponse coupée, un 5xx : la facture est peut-être partie. Elle bloque alors tout nouvel envoi de sa facture, la base
-- n'admettant qu'une transmission active (transmissions_factures_une_active), et c'est voulu : la renvoyer pourrait la
-- transmettre deux fois. Le suivi de plateforme-agreee la tranche quand la plateforme du client sait retrouver un dépôt
-- par son identifiant de suivi ; Super PDP ne le permet pas, ni une plateforme dont la recherche ne filtre pas.
--
-- Le cabinet l'abandonne alors, après avoir vérifié sur la plateforme que la facture n'y est pas : elle passe en échec,
-- et la facture peut repartir. Pas avant un quart d'heure, le délai du suivi de plateforme-agreee : le dépôt part sous
-- vingt-cinq secondes, et une facture transmise deux fois coûte plus qu'une attente. Seule cette fonction le fait
-- depuis le navigateur — la table n'a pas de policy de modification —, pour un membre du cabinet du dossier.
create function public.abandonner_transmission(p_transmission_id uuid)
returns public.transmissions_factures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transmission public.transmissions_factures;
begin
  select * into v_transmission from public.transmissions_factures t where t.id = p_transmission_id for update;
  if not found then
    raise exception 'Transmission introuvable.' using errcode = 'P0002';
  end if;
  if not admin_du_dossier(v_transmission.dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if v_transmission.etat <> 'envoi' then
    raise exception 'Seule une transmission dont l''issue est inconnue s''abandonne (celle-ci est « % »).', v_transmission.etat
      using errcode = '22023';
  end if;
  if v_transmission.cree_le > now() - interval '15 minutes' then
    raise exception 'Une transmission ne s''abandonne qu''un quart d''heure après son départ : la plateforme la reçoit peut-être encore.'
      using errcode = '22023';
  end if;
  update public.transmissions_factures
     set etat = 'echec',
         detail = 'Abandonnée par le cabinet, qui a vérifié que la plateforme ne l''a pas reçue : la facture peut repartir.'
   where id = p_transmission_id
  returning * into v_transmission;
  return v_transmission;
end
$$;
revoke execute on function public.abandonner_transmission(uuid) from public, anon;
grant execute on function public.abandonner_transmission(uuid) to authenticated;

comment on function public.abandonner_transmission(uuid) is
  'Passe en échec une transmission restée « envoi » (issue inconnue) depuis plus d''un quart d''heure, pour un membre du cabinet du dossier qui a vérifié sur la plateforme que la facture ne l''a pas atteinte : la facture peut alors repartir.';
