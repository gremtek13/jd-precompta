// Les montants d'une ligne de facture et ceux de l'en-tête : un calcul pur, sans le client Supabase, que factures.ts
// réexporte et que le générateur de la facture électronique (factureCii.ts) reprend.

// ── DÉBUT COPIE montantsFacture ──────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans les Edge Functions qui transmettent une facture (superpdp-emit,
// plateforme-agreee) et dans celle qui l'envoie par e-mail (send-email) : elles sont auto-portées, et le générateur de la
// facture électronique, que les deux premières recopient aussi, en dépend. `copiesFacturation.test.ts` compare chaque
// copie à celui-ci et l'exécute seule.

export interface LigneCalculee {
  montant_ht: number
  montant_tva: number
  montant_ttc: number
}

// LE CALCUL SE FAIT SUR LES DÉCIMAUX QUE LA BASE REÇOIT, EN ENTIERS. Une quantité, un prix et un taux partent en JSON,
// qui écrit d'un nombre son écriture décimale la plus courte (celle de `String`), et la base la garde EXACTEMENT, dans une
// colonne `numeric`. Le nombre binaire que tient le navigateur n'est pas ce décimal : 32,05 y vaut 32,04999999999999716…,
// si bien que 0,5 × 32,05 × 100 y faisait 1 602,4999… et que l'arrondi rendait 16,02 € d'une ligne de 16,025 €, quand le
// demi éloigné de zéro en fait 16,03 € (de même 0,5 × 2,01 et 1,5 × 0,15). La base refait ce calcul pour plafonner les
// encaissements (`centimes_ligne_facture`), en `numeric` depuis la correction de la facture (31/10/2026) : les deux côtés
// arrondissent le même décimal. Un nombre se lit donc comme un entier et une puissance de dix — « 32.05 », 3205 × 10⁻² ;
// « 1.5e-7 », 15 × 10⁻⁸ —, et le calcul se fait en entiers (BigInt), sans perte.
function enDecimal(x: number): [bigint, number] {
  const [mantisse, exposant = '0'] = String(x).split('e')
  const [entiere, fraction = ''] = mantisse.split('.')
  return [BigInt(entiere + fraction), Number(exposant) - fraction.length]
}

// `entier` × 10^`puissance`, à l'unité, le demi ÉLOIGNÉ DE ZÉRO dans les deux sens : la règle de `round` sur un `numeric`.
// Une ligne d'avoir à −0,125 € vaut −0,13 €, comme la même ligne d'une facture vaut 0,13 € : l'avoir, relu dans son sens
// par le générateur de la facture électronique (un avoir de la norme porte des montants positifs), retrouve les montants
// qu'on a enregistrés.
function aLUnite(entier: bigint, puissance: number): bigint {
  if (puissance >= 0) return entier * 10n ** BigInt(puissance)
  const diviseur = 10n ** BigInt(-puissance)
  const quotient = entier / diviseur
  const reste = entier % diviseur
  return 2n * (reste < 0n ? -reste : reste) >= diviseur ? quotient + (entier < 0n ? -1n : 1n) : quotient
}

// Chaque ligne est arrondie avant d'être sommée (comme le ferait n'importe quel logiciel de facturation), plutôt que de
// sommer des valeurs brutes puis d'arrondir le total : les deux méthodes peuvent différer d'un centime. Le HT au centime,
// puis la TVA sur ce HT, au centime ; le TTC, leur somme. Une valeur qui n'est pas un nombre fini ne fait pas un montant.
export function calculerLigne(quantite: number, prixUnitaireHt: number, tauxTva: number): LigneCalculee {
  if (!Number.isFinite(quantite) || !Number.isFinite(prixUnitaireHt) || !Number.isFinite(tauxTva)) {
    return { montant_ht: Number.NaN, montant_tva: Number.NaN, montant_ttc: Number.NaN }
  }
  const [q, puissanceQ] = enDecimal(quantite)
  const [p, puissanceP] = enDecimal(prixUnitaireHt)
  const [t, puissanceT] = enDecimal(tauxTva)
  const ht = aLUnite(q * p, puissanceQ + puissanceP + 2)
  const tva = aLUnite(ht * t, puissanceT - 2)
  return { montant_ht: Number(ht) / 100, montant_tva: Number(tva) / 100, montant_ttc: Number(ht + tva) / 100 }
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
