
-- Permet plusieurs conversations distinctes par dossier (voir audit ergonomie) au lieu d'un seul fil
-- que "Nouvelle conversation" effaçait entièrement. Un conversation_id regroupe les messages d'un
-- même fil ; les anciens messages (avant cette migration) forment chacun un fil par dossier, plutôt
-- que de rester orphelins d'un identifiant.
alter table agent_conversations add column conversation_id uuid;

update agent_conversations ac
set conversation_id = grp.id
from (select dossier_id, gen_random_uuid() as id from agent_conversations group by dossier_id) grp
where ac.dossier_id = grp.dossier_id;

alter table agent_conversations alter column conversation_id set not null;
alter table agent_conversations alter column conversation_id set default gen_random_uuid();

create index if not exists agent_conversations_conversation_id_idx
  on agent_conversations (dossier_id, conversation_id, created_at);
