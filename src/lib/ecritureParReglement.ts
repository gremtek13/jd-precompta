import { CHAMPS_BNC_EXPORTES } from './champsBncExportes'
import { dateLocaleDe } from './format'
import {
  cleDuPaiement, estParLeReleve, partsDesPaiements, rattachementsTresorerie, type PaiementDePiece,
} from './rattachement'
import type { Piece } from './types'

// UNE LIGNE DE CHARGE ET UNE LIGNE DE TVA PAR RÈGLEMENT D'UNE MÊME DATE (ligne 26.6, étape e ; lot FEC22c2 ; MVP-D5). Le
// FEC d'un BNC en trésorerie porte, sur chaque ligne, la date et le mode du règlement de son écriture (LPF, art. A47 A-1,
// VIII, 7°), et la validation les FIGE ligne par ligne (migration `champs_bnc_du_fec`, FEC22b) : une ligne du brouillon ne
// porte qu'un jeu de valeurs. Or une pièce payée le même jour par deux modes — la banque et la caisse, la banque et la poche
// de l'exploitant, la banque et un virement mixte, un paiement partiel le jour de la facture — fait deux écritures du
// fichier (une par mode : lib/fec.ts, `scinderParMode`), quand sa charge de la date n'avait qu'UNE ligne. Le fichier la
// scindait en deux lignes de même identifiant, que la validation ne peut pas figer (la base refuse une ligne reçue deux
// fois : « La numérotation proposée ne couvre pas exactement les N écritures de l'exercice A. »).
//
// Retenu (la recommandation de FEC22c1, reprise par la session) : la GÉNÉRATION écrit, à une telle date, une ligne de charge
// et une ligne de TVA par règlement (lib/ecritures.ts, `lignesChargeProduitPourPiece`), et la numérotation n'a plus qu'à
// RANGER chaque ligne dans l'écriture de son règlement (lib/fec.ts) ; elle ne scinde plus qu'un brouillon généré avant,
// que la validation refuse alors en le nommant (`defautsDeNumerotation`, une ligne numérotée deux fois). Ce module tient ce
// que les deux côtés partagent, pour qu'ils ne divergent pas d'un centime : les règlements d'une pièce à une date, et la
// répartition des lignes de la date entre eux.
//
// LES RÈGLEMENTS DE LA GÉNÉRATION NE LISENT PAS LE REGISTRE DES ENCAISSEMENTS. La génération ne le reçoit pas (et ne doit pas
// en dépendre : un encaissement retiré ne change pas ce qu'une pièce a payé). Ses règlements sont donc un découpage AU MOINS
// AUSSI FIN que celui du fichier (`cleDuReglement`, lib/champsBncDuFec.ts, qui sépare deux virements mixtes de deux moyens) :
// le relevé (rapprochements et parts de virements groupés : « Banque »), CHAQUE virement mixte (un par mouvement : son
// moyen, le fichier le lit au registre), la caisse, la poche de l'exploitant, la part que rien ne paie. Chacun tombe dans
// un seul règlement du fichier ; deux virements mixtes du même moyen, le même jour, font deux lignes dans une écriture.
//
// UN MODULE PUR : ni base, ni horloge. Le drapeau (`CHAMPS_BNC_EXPORTES`, lib/champsBncExportes.ts) n'est lu que par
// `ecritureParReglement`, à l'appel, pour la génération seule.

/**
 * LA GÉNÉRATION RÉPARTIT-ELLE UNE DATE ENTRE SES RÈGLEMENTS ? Quand le FEC porte les quatre champs d'un BNC
 * (`CHAMPS_BNC_EXPORTES` levé, lot FEC22c2) : la validation les fige alors ligne par ligne. Lu à l'appel, jamais au
 * chargement d'un module : les tests jouent ses deux états par un accesseur sur lib/champsBncExportes.ts.
 */
export function ecritureParReglement(): boolean {
  return CHAMPS_BNC_EXPORTES !== null
}

/** Les sortes de règlement de la génération, dans l'ordre du fichier (`ORDRE_DES_REGLEMENTS`, lib/champsBncDuFec.ts). */
export type SorteDeReglement = 'releve' | 'virement_mixte' | 'caisse' | 'note_de_frais' | 'aucun'

const ORDRE: Readonly<Record<SorteDeReglement, number>> = { releve: 0, virement_mixte: 1, caisse: 2, note_de_frais: 3, aucun: 4 }

/** Un règlement d'une pièce à une date, tel que la génération le sépare : sa clé, la part de la pièce qu'il porte, ses paiements. */
export interface ReglementDeLaDate {
  sorte: SorteDeReglement
  // `releve`, `mixte|<mouvement>`, `caisse`, `note_de_frais`, `aucun` : ce qui distingue deux lignes de la même charge.
  cle: string
  // La part de la pièce que ce règlement porte à cette date, comme `centimesParDate` la compte (lib/rattachement.ts) : la
  // somme des parts de ses paiements, ou celle que rien ne paie.
  part: number
  // Les paiements de la pièce qui le font, à cette date (aucun pour la poche de l'exploitant ni pour la part sans paiement).
  paiements: readonly PaiementDePiece[]
}

function sorteDuPaiement(p: PaiementDePiece): { sorte: SorteDeReglement; cle: string } {
  if (!estParLeReleve(p)) return { sorte: 'caisse', cle: 'caisse' }
  if (p.origine === 'encaissements') return { sorte: 'virement_mixte', cle: `mixte|${p.id}` }
  return { sorte: 'releve', cle: 'releve' }
}

/**
 * Les règlements d'une pièce à une date d'écriture, dans l'ordre du fichier — le relevé, les virements mixtes (par
 * mouvement), la caisse, la poche de l'exploitant, rien —, chacun avec sa part : celle de CHAQUE paiement
 * (`partsDesPaiements`), et la part que rien ne paie (`rattachementsTresorerie`), la part sans date reportée au jour du
 * dépôt comme `centimesParDate` la date. Leurs parts somment à celle que `centimesParDate` donne à la date.
 */
export function reglementsDeLaDate(
  piece: Pick<Piece, 'date_piece' | 'montant_ttc' | 'type_piece' | 'created_at'>,
  paiements: readonly PaiementDePiece[],
  date: string,
): ReglementDeLaDate[] {
  const trouves: { sorte: SorteDeReglement; cle: string; part: number; paiements: PaiementDePiece[] }[] = []
  const ajouter = (sorte: SorteDeReglement, cle: string, part: number, paiement: PaiementDePiece | null) => {
    const deja = trouves.find((x) => x.cle === cle)
    if (deja) {
      deja.part += part
      if (paiement !== null) deja.paiements.push(paiement)
      return
    }
    trouves.push({ sorte, cle, part, paiements: paiement === null ? [] : [paiement] })
  }
  // Des paiements dont la somme est NULLE — un prélèvement et son rejet pas encore repris, un paiement de zéro euro — ne paient
  // rien : `partsDesPaiements` ne leur rend aucune part, et la pièce compte, à sa date, comme sans paiement (la part `aucun`
  // ci-dessous). Ils ne font donc aucun règlement (lot FEC22c3 : `parts[i]` manquait, et la génération levée levait).
  const { parts } = partsDesPaiements(piece, paiements)
  paiements.forEach((p, i) => {
    if (p.date !== date || parts.length === 0) return
    const { sorte, cle } = sorteDuPaiement(p)
    ajouter(sorte, cle, parts[i].part, p)
  })
  for (const r of rattachementsTresorerie(piece, paiements)) {
    if (r.source === 'paiement' || r.source === 'facture') continue
    if ((r.date ?? dateLocaleDe(piece.created_at)) !== date) continue
    const sorte: SorteDeReglement = r.source === 'note_de_frais' ? 'note_de_frais' : 'aucun'
    ajouter(sorte, sorte, r.part, null)
  }
  // À sorte égale (deux virements mixtes), par la clé de leur paiement : deux appels rendent la même chose.
  const premiere = (x: { paiements: readonly PaiementDePiece[] }) => (x.paiements[0] ? cleDuPaiement(x.paiements[0]) : '')
  return trouves.sort((a, b) => ORDRE[a.sorte] - ORDRE[b.sorte] || premiere(a).localeCompare(premiere(b)))
}

/**
 * La date se répartit-elle entre plusieurs règlements ? Deux au moins, et une somme des parts positive — la garde de
 * `scinderParMode` : une date dont les parts s'annulent (un prélèvement et son rejet le même jour) ne se divise pas.
 */
export function seRepartit(reglements: readonly Pick<ReglementDeLaDate, 'part'>[]): boolean {
  return reglements.length >= 2 && reglements.reduce((s, r) => s + r.part, 0) > 0
}

/**
 * Un montant réparti au centime selon des poids, le dernier morceau prenant l'arrondi pour que la somme reste le total — la
 * règle de `centimesParDate` (lib/rattachement.ts), qui a fait le total de la date.
 */
export function repartir(total: number, poids: readonly number[]): number[] {
  const somme = poids.reduce((s, p) => s + p, 0)
  const morceaux = poids.map((p) => Math.round(total * (p / somme)))
  morceaux[morceaux.length - 1] = total - morceaux.slice(0, -1).reduce((s, m) => s + m, 0)
  return morceaux
}

/**
 * LA RÉPARTITION DES LIGNES QU'UNE DATE PARTAGE ENTRE SES RÈGLEMENTS, la même pour la génération et pour le fichier.
 * `centimes` : chaque ligne partagée de la date, en centimes SIGNÉS (le débit positif), dans l'ordre — la charge ou le
 * produit d'abord, la TVA en dernier ; `poids` : la part de chaque règlement. Rend, pour chaque ligne, ses centimes par
 * règlement. La pièce entière d'abord (charge et TVA ensemble), puis chaque ligne, la dernière — la TVA — prenant ce qui
 * reste du total de son règlement : la TVA d'un règlement complète sa charge, comme `lignesChargeProduitPourPiece` le fait
 * d'une date, et chaque écriture d'un règlement s'équilibre face à sa banque. Le total de chaque ligne est intact.
 */
export function repartirLesLignesPartagees(centimes: readonly number[], poids: readonly number[]): number[][] {
  const totaux = repartir(centimes.reduce((s, c) => s + c, 0), poids)
  const parLigne = centimes.map((c) => repartir(c, poids))
  if (parLigne.length > 0) {
    parLigne[parLigne.length - 1] = totaux.map((t, i) => t - parLigne.slice(0, -1).reduce((s, m) => s + m[i], 0))
  }
  return parLigne
}
