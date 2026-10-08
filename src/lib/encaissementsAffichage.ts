import {
  obligationEncaissee, resteAEncaisser,
  type EncaissementLu, type FacturePourEncaissement, type FacturePourObligation, type LigneDeFacture, type PartLue,
} from './encaissementsFactures'
import { formatMoney } from './format'
import type { StatutTva } from './types'

// CE QUE L'ÉCRAN DES ENCAISSEMENTS DIT D'UNE FACTURE ÉMISE (ligne 28.5, étape d3), sans rien lire : la pastille de
// l'onglet Factures, et la saisie d'un montant. Le jugement — l'obligation, le reste, les refus — reste celui du module
// d2 (encaissementsFactures.ts) : ce fichier ne fait que le mettre en mots.

export interface PastilleEncaissement {
  libelle: string
  /** Une classe de pastille d'index.css. */
  classe: 'badge-ok' | 'badge-warning' | 'badge-neutral'
}

/**
 * La pastille d'encaissement d'une facture de l'onglet Factures, selon `resteAEncaisser` : « Encaissée », « Encaissée
 * en partie — 600,00 € sur 1 200,00 € » ou « À encaisser ». Rien pour un brouillon ou un avoir, ni quand le statut
 * « Encaissée » est SANS OBJET (un particulier, une livraison de biens, un dossier exonéré…) : la pastille ne dit pas
 * une obligation qui n'existe pas. Elle ne compte pas les avoirs, comme la base : la fenêtre dit leur effet.
 *
 * Les listes sont celles du dossier, LUES EN ENTIER — l'appelant qui ne les a pas toutes n'en affiche aucune : une
 * liste d'encaissements tronquée ferait dire « À encaisser » d'une facture payée.
 */
export function pastilleEncaissement(
  facture: FacturePourEncaissement & FacturePourObligation,
  lignes: readonly LigneDeFacture[],
  encaissements: readonly EncaissementLu[],
  parts: readonly PartLue[],
  statutTva: StatutTva | null,
): PastilleEncaissement | null {
  if (facture.statut !== 'validee' || facture.type !== 'facture') return null
  if (obligationEncaissee(facture, lignes, statutTva).etat === 'sans_objet') return null
  const r = resteAEncaisser({ facture, lignes, encaissements, parts })
  // Une facture validée sans ligne lue n'a rien à encaisser qu'on sache dire.
  if (r.ttcCentimes <= 0) return null
  if (r.encaisseCentimes <= 0) return { libelle: 'À encaisser', classe: 'badge-neutral' }
  if (r.resteCentimes <= 0) return { libelle: 'Encaissée', classe: 'badge-ok' }
  return {
    libelle: `Encaissée en partie — ${formatMoney(r.encaisseCentimes / 100)} sur ${formatMoney(r.ttcCentimes / 100)}`,
    classe: 'badge-warning',
  }
}

/**
 * Un montant en euros tel qu'on le tape : « 1 200,50 », « 1200.5 », « 600 ». Les espaces (dont les insécables que
 * `formatMoney` écrit, si on recopie un montant affiché) et le symbole € s'ignorent, la virgule vaut le point. Rien
 * d'autre n'est deviné — pas de séparateur de milliers par un point, pas de signe — : NaN pour tout ce qui ne se lit
 * pas ainsi, null pour un champ vide. Le nombre rendu, la base le jugera au centime (`centimesExacts`) : 12,345 se lit,
 * et se refuse ensuite sous ses mots.
 */
export function lireMontantSaisi(texte: string): number | null {
  const net = texte.replace(/[\s\u00a0\u202f€]/g, '')
  if (net === '') return null
  if (!/^\d+(?:[.,]\d+)?$/.test(net)) return Number.NaN
  return Number(net.replace(',', '.'))
}

/** Un montant en centimes, écrit pour un champ de saisie : « 1355,50 » — sans séparateur de milliers, qu'on retaperait. */
export function montantPourSaisie(centimes: number): string {
  const signe = centimes < 0 ? '-' : ''
  const a = Math.abs(centimes)
  return `${signe}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`
}

/** Un taux de TVA à l'écran : « 5,5 % ». */
export function tauxAffiche(taux: number): string {
  return `${String(taux).replace('.', ',')} %`
}
