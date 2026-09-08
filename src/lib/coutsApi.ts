// Estimation du coût de l'agent comptable (Claude Sonnet 4.6 via Amazon Bedrock — voir
// supabase/functions/agent-comptable) à partir des tokens réellement consommés (voir
// agent_conversations.tokens_entree/tokens_sortie, alimentés depuis la réponse de la fonction).
// Sert uniquement à suivre l'ordre de grandeur de la consommation par dossier/cabinet (voir
// SuperAdminPage, "Comptes master") — jamais une facture AWS exacte : ne couvre que Claude/Bedrock,
// pas les autres API payantes de l'appli (Textract pour l'OCR des pièces, notamment), et les tarifs
// ci-dessous sont ceux du catalogue Claude Sonnet au moment de l'écriture, à ajuster si le modèle
// change (voir MODEL dans agent-comptable) ou si Bedrock facture différemment de l'API Anthropic
// directe sur ce compte.
export const PRIX_TOKEN_ENTREE_USD = 3 / 1_000_000
export const PRIX_TOKEN_SORTIE_USD = 15 / 1_000_000

export function estimerCoutUsd(tokensEntree: number, tokensSortie: number): number {
  return tokensEntree * PRIX_TOKEN_ENTREE_USD + tokensSortie * PRIX_TOKEN_SORTIE_USD
}

// Bedrock facture en dollars US, jamais en euros — un formatteur dédié plutôt que de forcer
// formatMoney (fixé sur EUR, voir lib/format.ts) à gérer une seconde devise pour ce seul usage.
export function formatUsd(value: number): string {
  return value.toLocaleString('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 4 : 2 })
}
