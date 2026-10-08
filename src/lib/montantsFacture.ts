// Les montants d'une ligne de facture et ceux de l'en-tête : un calcul pur, sans le client Supabase, que factures.ts
// réexporte et que le générateur de la facture électronique (factureCii.ts) reprend.

// ── DÉBUT COPIE montantsFacture ──────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans les Edge Functions qui transmettent une facture (superpdp-emit,
// plateforme-agreee) : elles sont auto-portées, et le générateur de la facture électronique, qu'elles recopient aussi,
// en dépend. `copiesFacturation.test.ts` compare chaque copie à celui-ci et l'exécute seule.

export interface LigneCalculee {
  montant_ht: number
  montant_tva: number
  montant_ttc: number
}

// Au centime, le demi ÉLOIGNÉ DE ZÉRO, dans les deux sens. `Math.round` arrondit le demi vers +∞ : une ligne d'avoir
// à -0,125 € valait -0,12 € quand la même ligne d'une facture vaut 0,13 €. L'avoir, relu dans son sens par le
// générateur de la facture électronique (un avoir de la norme porte des montants positifs), ne retrouvait plus les
// montants qu'on avait enregistrés, et ne se transmettait pas. Un montant positif s'arrondit exactement comme avant.
function auCentime(x: number): number {
  const c = Math.round(Math.abs(x) * 100) / 100
  return c === 0 ? 0 : x < 0 ? -c : c
}

// Arrondi à 2 décimales systématique — chaque ligne est arrondie avant d'être sommée (comme le ferait
// n'importe quel logiciel de facturation), plutôt que de sommer des valeurs flottantes brutes puis
// arrondir le total : les deux méthodes peuvent différer d'un centime sur certains taux de TVA.
export function calculerLigne(quantite: number, prixUnitaireHt: number, tauxTva: number): LigneCalculee {
  const ht = auCentime(quantite * prixUnitaireHt)
  const tva = auCentime(ht * (tauxTva / 100))
  return { montant_ht: ht, montant_tva: tva, montant_ttc: auCentime(ht + tva) }
}
// ── FIN COPIE montantsFacture ────────────────────────────────────────────────────────────────────────────────────────

// La somme se fait en CENTIMES ENTIERS. En flottants, 0,07 + 0,14 vaut 0,21000000000000002 : la base stocke les
// montants tels qu'on les envoie (colonnes numeric sans échelle), et un plafond comparé au centime près — ce qu'un
// avoir peut encore créditer — refuserait un montant juste pour une décimale que personne n'a saisie.
export function calculerTotaux(lignes: { quantite: number; prix_unitaire_ht: number; taux_tva: number }[]): LigneCalculee {
  let ht = 0
  let tva = 0
  let ttc = 0
  for (const l of lignes) {
    const c = calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva)
    ht += Math.round(c.montant_ht * 100)
    tva += Math.round(c.montant_tva * 100)
    ttc += Math.round(c.montant_ttc * 100)
  }
  return { montant_ht: ht / 100, montant_tva: tva / 100, montant_ttc: ttc / 100 }
}
