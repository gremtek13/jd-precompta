import {
  echeanceDeDeclaration, obligationEncaissee, refusDeclaration, resteAEncaisser,
  type DeclarationLue, type EncaissementPourContrePassation, type EncaissementLu, type EvenementSuperpdpLu,
  type FacturePourEncaissement, type FacturePourObligation, type LigneDeFacture, type PartLue, type PartProposee,
  type StatutPlateformeLu, type TransmissionPourDeclaration,
} from './encaissementsFactures'
import { formatMoney } from './format'
import type { StatutTva } from './types'

// CE QUE L'ÉCRAN DES ENCAISSEMENTS DIT D'UNE FACTURE ÉMISE (ligne 28.5, étape d3), sans rien lire : la pastille de
// l'onglet Factures, et la saisie d'un montant. Le jugement — l'obligation, le reste, les refus — reste celui du module
// d2 (encaissementsFactures.ts) : ce fichier ne fait que le mettre en mots.

export interface PastilleEncaissement {
  libelle: string
  /** Une classe de pastille d'index.css. */
  classe: 'badge-ok' | 'badge-warning' | 'badge-neutral' | 'badge-danger'
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
 * La pastille de DÉCLARATION d'une facture de l'onglet Factures (ligne 28.5, étape d4) : « À déclarer » quand un
 * encaissement — ou une contre-passation — qui compte n'est pas déclaré, « Déclaration en retard » quand l'échéance de
 * l'un d'eux est passée au jour de Paris (`aujourdHui`). Une SECONDE pastille, à côté de celle de l'encaissement : l'une
 * dit un fait (ce que le client a payé), qui vaut quelle que soit l'obligation ; l'autre une obligation envers
 * l'administration, qui ne vaut que lorsqu'elle est DUE. Les fondre ferait porter deux statuts à une couleur — une facture
 * « Encaissée » peut avoir une déclaration en retard.
 *
 * Rien quand l'obligation n'est pas due : facultative, rien n'est en retard ni exigé, et la fenêtre dit ce qui se
 * déclare ; sans objet, à préciser ou refusée, rien ne se déclare d'ici. Un encaissement compte « à déclarer » quand la
 * base inscrirait sa déclaration (`refusDeclaration` sans refus), et seulement alors. Pas quand la facture a été rejetée
 * ou refusée, chez Super PDP comme sur la plateforme du client (`statutsRecus`, étape d7) : aucun statut ne la suit, elle
 * s'annule par un avoir interne. Pas non plus quand aucune plateforme ne l'a
 * acceptée par l'application — jamais transmise d'ici, déposée sans accusé, ou déposée par le client lui-même : une
 * déclaration faite ailleurs ne s'inscrirait pas ici, et « Déclaration en retard » s'y allumerait sans que rien d'ici
 * puisse l'éteindre. Le statut y reste dû : la fenêtre le dit, avec son échéance, et pourquoi il ne se déclare pas d'ici.
 *
 * Les listes sont celles du dossier, LUES EN ENTIER — une déclaration qui manquerait ferait dire « À déclarer » d'un
 * encaissement déjà déclaré : l'appelant qui ne les a pas toutes n'en affiche aucune.
 */
export function pastilleDeclaration(
  dossierId: string,
  facture: FacturePourEncaissement & FacturePourObligation,
  lignes: readonly Pick<LigneDeFacture, 'facture_id' | 'taux_tva'>[],
  encaissements: readonly (EncaissementLu & Pick<EncaissementPourContrePassation, 'date_encaissement'>)[],
  declarations: readonly Pick<DeclarationLue, 'encaissement_id' | 'etat'>[],
  transmissions: readonly TransmissionPourDeclaration[],
  evenementsSuperpdp: readonly EvenementSuperpdpLu[],
  statutsRecus: readonly StatutPlateformeLu[],
  statutTva: StatutTva | null,
  aujourdHui: string,
): PastilleEncaissement | null {
  // Un brouillon, un avoir : `obligationEncaissee` les dit sans objet, et rien ne se déclare.
  if (obligationEncaissee(facture, lignes, statutTva).etat !== 'due') return null
  const aDeclarer = encaissements.filter((e) => e.facture_id === facture.id
    && refusDeclaration(dossierId, e.id, encaissements, declarations, transmissions, evenementsSuperpdp, statutsRecus, null) == null)
  if (aDeclarer.length === 0) return null
  const enRetard = aDeclarer.some((e) => {
    const echeance = echeanceDeDeclaration(e.date_encaissement, statutTva)
    return echeance != null && echeance.date < aujourdHui
  })
  return enRetard
    ? { libelle: 'Déclaration en retard', classe: 'badge-danger' }
    : { libelle: 'À déclarer', classe: 'badge-warning' }
}

/**
 * Les parts d'un encaissement en mots, telles que la confirmation les nomme : « 1 000,00 € à 20 %, 100,00 € à 5,5 % et
 * 50,00 € à 0 % ». Dans l'ordre reçu ; une liste vide rend une chaîne vide.
 */
export function partsEnMots(parts: readonly PartProposee[]): string {
  const mots = parts.map((p) => `${formatMoney(p.centimes / 100)} à ${tauxAffiche(p.taux)}`)
  return mots.length <= 1 ? mots.join('') : `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`
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
