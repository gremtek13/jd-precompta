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
  // LES STATUTS DU CYCLE DE VIE, sous les libellés de la DGFiP (ligne 28.5, étape d3) : tableau 8 des spécifications
  // externes de la facturation électronique, v3.2 du 30/04/2026, § 3.6.4, p. 59 — relu le 08/10/2026. 200, 210, 212
  // et 213 sont les statuts OBLIGATOIRES, ceux que l'administration reçoit : l'écran les nomme comme elle, pour que
  // « Encaissée » ici soit « Encaissée » là-bas. Les autres sont facultatifs, et nommés de même. 201 s'y écrit
  // « Emise », la capitale sans son accent ; on la lui rend.
  'fr:200': { libelle: 'Déposée', niveau: 'attente' },
  'fr:201': { libelle: 'Émise par la plateforme', niveau: 'attente' },
  'fr:202': { libelle: 'Reçue par la plateforme', niveau: 'attente' },
  'fr:203': { libelle: 'Mise à disposition', niveau: 'attente' },
  'fr:204': { libelle: 'Prise en charge', niveau: 'attente' },
  'fr:205': { libelle: 'Approuvée', niveau: 'ok' },
  'fr:206': { libelle: 'Approuvée partiellement', niveau: 'attente' },
  'fr:207': { libelle: 'En litige', niveau: 'probleme' },
  'fr:208': { libelle: 'Suspendue', niveau: 'attente' },
  'fr:209': { libelle: 'Complétée', niveau: 'ok' },
  'fr:210': { libelle: 'Refusée', niveau: 'probleme' },
  'fr:211': { libelle: 'Paiement transmis', niveau: 'ok' },
  'fr:212': { libelle: 'Encaissée', niveau: 'ok' },
  'fr:213': { libelle: 'Rejetée', niveau: 'probleme' },
  // Hors du tableau 8 : le statut d'un FLUX que le portail public juge irrecevable (annexe 2, v2.3, onglet « Statuts »,
  // « Objet : Flux »), sous le même libellé.
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
