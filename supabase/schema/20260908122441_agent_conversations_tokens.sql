-- Consommation de tokens Claude/Bedrock par message assistant (voir agent-comptable) — sert à
-- estimer le coût réel de l'agent comptable par dossier, puis par cabinet (voir Comptes master).
-- Nul sur un message 'user' (aucun appel modèle) et sur tout message assistant enregistré avant
-- l'ajout de ce suivi.
alter table agent_conversations
  add column tokens_entree integer,
  add column tokens_sortie integer;

comment on column agent_conversations.tokens_entree is 'Tokens Claude en entrée (usage.input_tokens Bedrock), cumulés sur tous les tours de la conversation ayant produit cette réponse. Null pour un message user ou un message assistant antérieur à ce suivi.';
comment on column agent_conversations.tokens_sortie is 'Tokens Claude en sortie (usage.output_tokens Bedrock), même périmètre que tokens_entree.';
