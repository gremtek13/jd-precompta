// Les montants d'une ligne de facture et ceux de l'en-tête : un calcul pur, sans le client Supabase, que factures.ts
// réexporte et que le générateur de la facture électronique (factureCii.ts) reprend. superpdp-emit en garde une copie,
// confrontée à celle-ci par superpdpMontants.test.ts.

export interface LigneCalculee {
  montant_ht: number
  montant_tva: number
  montant_ttc: number
}

// Arrondi à 2 décimales systématique — chaque ligne est arrondie avant d'être sommée (comme le ferait
// n'importe quel logiciel de facturation), plutôt que de sommer des valeurs flottantes brutes puis
// arrondir le total : les deux méthodes peuvent différer d'un centime sur certains taux de TVA.
export function calculerLigne(quantite: number, prixUnitaireHt: number, tauxTva: number): LigneCalculee {
  const ht = Math.round(quantite * prixUnitaireHt * 100) / 100
  const tva = Math.round(ht * (tauxTva / 100) * 100) / 100
  return { montant_ht: ht, montant_tva: tva, montant_ttc: Math.round((ht + tva) * 100) / 100 }
}

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
