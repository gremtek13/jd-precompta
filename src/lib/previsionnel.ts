export interface PrevisionnelBancaire {
  dossier_id: string
  annee_reference: number
  ca_reference: number
  charges_reference: number
  taux_croissance_ca: number
  taux_croissance_charges: number
  note_hypotheses: string | null
  updated_at: string
}

export interface AnneePrevisionnelle {
  annee: number
  ca: number
  charges: number
  resultat: number
}

// Dernière brique du "dossier bancaire automatisé" (voir CLAUDE.md) — projection à 3 ans par taux de
// croissance uniforme (composé), appliqué à un CA et des charges de référence saisis et validés par
// le cabinet. Volontairement simple (un seul taux global, pas un budget poste par poste) : les
// hypothèses de croissance restent la responsabilité du cabinet (voir note_hypotheses, saisie libre
// jamais préremplie), l'app ne prétend jamais deviner un taux réaliste à sa place. Le CA et les
// charges de référence peuvent être préchargés depuis une année passée via calculerSituationIntermediaire
// (voir FinancementTab) — un simple point de départ, toujours modifiable avant enregistrement.
export function calculerPrevisionnel(
  anneeReference: number, caReference: number, chargesReference: number,
  tauxCroissanceCa: number, tauxCroissanceCharges: number, nbAnnees = 3,
): AnneePrevisionnelle[] {
  const lignes: AnneePrevisionnelle[] = []
  for (let i = 1; i <= nbAnnees; i++) {
    const ca = Math.round(caReference * Math.pow(1 + tauxCroissanceCa / 100, i) * 100) / 100
    const charges = Math.round(chargesReference * Math.pow(1 + tauxCroissanceCharges / 100, i) * 100) / 100
    lignes.push({ annee: anneeReference + i, ca, charges, resultat: Math.round((ca - charges) * 100) / 100 })
  }
  return lignes
}
