// Libellés français des status_code Super PDP (voir supabase/functions/superpdp-emit et la doc
// "Erreurs" : ce n'est PAS une machine à états — plusieurs statuts peuvent coexister dans l'historique,
// chacun signale qu'un événement s'est produit, pas un état exclusif courant). Couvre les codes les
// plus significatifs pour un comptable ; un code inconnu s'affiche tel quel plutôt que de planter.
export type NiveauStatut = 'ok' | 'attente' | 'probleme' | 'neutre'

interface InfoStatut { libelle: string; niveau: NiveauStatut }

const STATUTS: Record<string, InfoStatut> = {
  'api:uploaded': { libelle: 'Déposée', niveau: 'attente' },
  'api:invalid': { libelle: 'Invalide (rejetée avant envoi)', niveau: 'probleme' },
  'api:validated': { libelle: 'Validée (contrôles passés)', niveau: 'attente' },
  'api:sent': { libelle: 'Transmise', niveau: 'attente' },
  'api:rejected': { libelle: 'Rejetée par le destinataire', niveau: 'probleme' },
  'api:acknowledged': { libelle: 'Accusé de réception reçu', niveau: 'attente' },
  'api:accepted': { libelle: 'Acceptée par le destinataire', niveau: 'ok' },
  'fr:200': { libelle: 'Soumise', niveau: 'attente' },
  'fr:201': { libelle: 'Envoyée', niveau: 'attente' },
  'fr:202': { libelle: 'Reçue', niveau: 'attente' },
  'fr:203': { libelle: 'Mise à disposition', niveau: 'attente' },
  'fr:204': { libelle: 'Accusé de réception', niveau: 'attente' },
  'fr:205': { libelle: 'Acceptée', niveau: 'ok' },
  'fr:206': { libelle: 'Partiellement acceptée', niveau: 'attente' },
  'fr:207': { libelle: 'Contestée', niveau: 'probleme' },
  'fr:208': { libelle: 'En attente', niveau: 'attente' },
  'fr:209': { libelle: 'Complétée', niveau: 'ok' },
  'fr:210': { libelle: 'Refusée', niveau: 'probleme' },
  'fr:211': { libelle: 'Paiement envoyé', niveau: 'ok' },
  'fr:212': { libelle: 'Paiement reçu', niveau: 'ok' },
  'fr:213': { libelle: 'Rejetée', niveau: 'probleme' },
  'fr:501': { libelle: 'Irrecevable', niveau: 'probleme' },
}

export function libelleStatutSuperpdp(code: string): string {
  return STATUTS[code]?.libelle ?? code
}

export function niveauStatutSuperpdp(code: string | null): NiveauStatut {
  if (!code) return 'neutre'
  return STATUTS[code]?.niveau ?? 'neutre'
}

// Classe de badge déjà présente dans index.css (badge-ok/badge-warning/badge-danger/badge-neutral).
export function badgeClasseStatutSuperpdp(code: string | null): string {
  switch (niveauStatutSuperpdp(code)) {
    case 'ok': return 'badge-ok'
    case 'probleme': return 'badge-danger'
    case 'attente': return 'badge-warning'
    default: return 'badge-neutral'
  }
}
