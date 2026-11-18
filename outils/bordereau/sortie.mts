// CE QUE L'OUTIL LOCAL AFFICHE (conception 59, BOR1-Q4 (B) ; le lanceur : outils/bordereau/lire.mjs). Pur : le texte d'une
// lecture, et rien d'autre. Il ne reçoit que ce que `lireLeBordereauDeTeletransmission` rend — l'en-tête du lot et ses
// totaux, ou la raison d'un refus, qui ne cite jamais une valeur d'une ligne — et il n'y ajoute que le régime tiré du libellé
// de l'organisme (lib/regimesAssuranceMaladie.ts). Aucune ligne de facture ne peut s'afficher : elle n'est pas dans ce qu'il
// reçoit (src/lib/bordereauOutilLocal.test.ts le garde, sur le texte affiché par le vrai lanceur).

import type { BordereauLu, LectureDuBordereau } from '../../src/lib/bordereauDeTeletransmission'
import { codeDuRegime, regimeDuLibelle } from '../../src/lib/regimesAssuranceMaladie'

/** Un montant en euros à la française, les milliers séparés par une espace : « 4 600,10 € ». */
export function euros(centimes: number): string {
  const signe = centimes < 0 ? '-' : ''
  const abs = Math.abs(centimes)
  const entier = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${signe}${entier},${String(abs % 100).padStart(2, '0')} €`
}

function dateFrancaise(iso: string): string {
  const [annee, mois, jour] = iso.split('-')
  return `${jour}/${mois}/${annee}`
}

function lignesDUnBordereau(b: BordereauLu, rang: number, nombre: number): string[] {
  const regime = regimeDuLibelle(b.organisme.libelle)
  return [
    `Lot ${rang} sur ${nombre}`,
    `  Numéro du lot ........ ${b.lot}`,
    `  Créé le .............. ${dateFrancaise(b.creeLe)}`,
    `  Lot sécurisé ......... ${b.securise ? 'oui' : 'non'}`,
    `  Organisme ............ ${b.organisme.code} - ${b.organisme.libelle}`,
    regime.etat === 'reconnu'
      ? `  Régime ............... ${codeDuRegime(regime.regime)} (${regime.regime.intitule}, d'après le libellé)`
      : '  Régime ............... à choisir (le libellé ne le dit pas)',
    `  Factures ............. ${b.nombreDeFactures}`,
    `  Total ................ ${euros(b.totaux.totalCentimes)}`,
    `  Caisse ............... ${euros(b.totaux.caisseCentimes)}`,
    `  Mutuelle ............. ${euros(b.totaux.mutuelleCentimes)}`,
    `  Assuré ............... ${euros(b.totaux.assureCentimes)}`,
    `  Dû par l'assurance maladie (caisse + mutuelle) : ${euros(b.totaux.caisseCentimes + b.totaux.mutuelleCentimes)}`,
  ]
}

/** Le texte que l'outil affiche pour une lecture : le résultat, ou la raison du refus. */
export function texteDuResultat(lecture: LectureDuBordereau): string {
  const fin = 'Aucune ligne de facture n’est affichée, et rien n’a quitté cet ordinateur.'
  if (lecture.etat === 'refuse') {
    return [`BORDEREAU REFUSÉ : ${lecture.raison}.`, '', 'Rien n’a été lu à moitié : un bordereau refusé ne rend aucun chiffre.', fin].join('\n')
  }
  const n = lecture.bordereaux.length
  const blocs = lecture.bordereaux.map((b, i) => lignesDUnBordereau(b, i + 1, n).join('\n'))
  return [`BORDEREAU LU : ${n} lot${n > 1 ? 's' : ''}, chacun contrôlé par son total.`, '', blocs.join('\n\n'), '', fin].join('\n')
}
