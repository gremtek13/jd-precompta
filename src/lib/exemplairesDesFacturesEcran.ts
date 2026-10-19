import { formatDate, formatMoney } from './format'
import { refusDeLaPieceDesignee, type PieceDesignable } from './exemplairesDesFactures'
import type { FactureProposee } from './exemplairesDesFacturesLecture'
import type { TypePiece } from './types'

// LES MOTS DE L'ÉCRAN DE L'EXEMPLAIRE D'UNE FACTURE (ligne 28.6, chantier EC-Q3, étape VF1b) : le choix de la facture, les
// deux confirmations et le refus du formulaire d'une pièce désignée. Un module PUR, comme le reste de la règle
// (lib/exemplairesDesFactures.ts, dont les refus se disent avant le clic, sous les mots de la base) : l'écran
// (pages/dossier/ExemplaireDeLaFacture.tsx) ne compose aucune phrase, et un test les confronte à ce que la confirmation doit
// NOMMER et à ce qu'elle doit dire que le geste ne change pas.

/** « la facture F2026-0007 » ou « l'avoir A2026-0001 » : la nature de ce que la pièce porte. */
export function nomDeLaFacture(f: Pick<FactureProposee, 'type' | 'numero'>): string {
  const numero = f.numero ?? '(sans numéro)'
  return f.type === 'avoir' ? `l’avoir ${numero}` : `la facture ${numero}`
}

/** Ce qui désigne la facture à qui la regarde : son client, son montant TTC (un avoir est négatif) et sa date d'émission. */
export function descriptionDeLaFacture(f: Pick<FactureProposee, 'tiers_nom' | 'montant_ttc' | 'date_emission'>): string {
  return `${f.tiers_nom}, ${formatMoney(f.montant_ttc)} TTC, émise le ${formatDate(f.date_emission)}`
}

/** La ligne du choix : de quoi retrouver la facture sans en connaître le numéro. */
export function ligneDuChoix(f: Pick<FactureProposee, 'type' | 'numero' | 'tiers_nom' | 'montant_ttc' | 'date_emission'>): string {
  return `${f.type === 'avoir' ? 'Avoir' : 'Facture'} ${f.numero ?? '(sans numéro)'} — ${formatDate(f.date_emission)} — ${f.tiers_nom} — ${formatMoney(f.montant_ttc)}`
}

// CE QUI SE COMPTE DÉPEND DE LA FACTURE (étape VF3b3). Depuis que la 2035, la CA3, la situation intermédiaire et l'estimation
// lisent les ventes facturées (lib/ventesFacturees.ts), une facture SOURCE de sa vente compte elle-même, et la pièce désignée
// comme son exemplaire ne compte plus. Désigner l'exemplaire d'une facture source retire donc la pièce de ce qui se compte ;
// défaire l'y remet, EN PLUS de la facture : la vente est comptée deux fois. Pour une facture qui n'est pas source, rien ne
// change, ni dans un sens ni dans l'autre. Chaque confirmation dit ce qui est vrai pour la facture choisie ; le paragraphe de
// la fiche, écrit avant tout choix, dit les deux cas.

/** Les états qui comptent une vente, nommés une fois pour les trois phrases. */
const LES_ETATS = 'la 2035, la CA3, la situation intermédiaire et l’estimation'

/** « La facture F… » ou « L'avoir A… » : en tête de phrase. */
function enTete(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1)
}

/**
 * Le paragraphe de la fiche d'une pièce de vente que rien ne désigne, avant tout choix : ce qu'est un exemplaire, ce que la
 * désignation change à la marque de la pièce, et ce qu'elle change à ce qui se compte — selon que la facture est source de sa
 * vente ou non, les deux cas, puisqu'aucune facture n'est encore choisie.
 */
export const PARAGRAPHE_DE_LA_DESIGNATION = 'Cette pièce de vente est peut-être l’exemplaire d’une facture émise dans l’application : '
  + 'l’original revenu de la plateforme du client, ou le PDF déposé. La désigner la relie à sa facture ; si une autre pièce '
  + 'porte déjà la même facture, la vente s’affiche « Comptée deux fois ». '
  + `Pour une facture source de sa vente, la pièce désignée cesse de compter dans ${LES_ETATS} : c’est la facture qui compte `
  + 'la vente. Pour une autre facture, désigner ne change rien à ce qui se compte.'

/**
 * La ligne de la fiche d'une pièce désignée : ce qu'elle est, et, pour une facture source, qu'elle ne compte pas — c'est la
 * facture qui compte la vente.
 */
export function phraseDeLaPieceDesignee(facture: FactureProposee): string {
  return `Cette pièce est désignée comme l’exemplaire de ${nomDeLaFacture(facture)}.`
    + (facture.source_de_la_vente
      ? ` ${enTete(nomDeLaFacture(facture))} est la source de sa vente : cette pièce ne compte pas dans ${LES_ETATS}, où la `
        + `vente n’est comptée que par ${nomDeLaFacture(facture)}.`
      : '')
}

/**
 * La confirmation de la désignation : elle NOMME la facture (numéro, client, montant TTC) et la pièce, et dit ce que le geste
 * change — la marque de la pièce, une vente qui peut se dire comptée deux fois — et ce qu'il change à ce qui se compte : pour
 * une facture source, la pièce cesse de compter ; pour une autre, rien. Le gel de la pièce fige la désignation : l'exercice
 * validé qui la porte ne la laisse plus changer.
 */
export function confirmationDeLaDesignation(nomFichier: string, facture: FactureProposee): string {
  const ceQuiSeCompte = facture.source_de_la_vente
    ? `${enTete(nomDeLaFacture(facture))} est la source de sa vente : désignée comme son exemplaire, la pièce cessera de compter `
      + `dans ${LES_ETATS}, où la vente ne sera plus comptée que par ${nomDeLaFacture(facture)}.`
    : 'Désigner ne change rien à ce qui se compte aujourd’hui.'
  const enDouble = facture.source_de_la_vente
    // Le pont ne connaît pas encore la source (étape VF6) : il dit « Comptée deux fois » dès que deux pièces portent la
    // facture. Pour une facture source, ce qui compte de trop est une pièce qui n'est PAS désignée.
    ? 'Si une autre pièce porte déjà la même facture, la vente s’affichera « Comptée deux fois » : une pièce de cette facture '
      + 'qui n’est pas désignée compte encore, en plus de la facture.'
    : 'Si une autre pièce porte déjà la même facture, la vente s’affichera « Comptée deux fois » : une vente ne se compte '
      + 'qu’une fois, il n’en faut garder qu’une.'
  return `Désigner la pièce « ${nomFichier} » comme l’exemplaire de ${nomDeLaFacture(facture)} (${descriptionDeLaFacture(facture)}) ?\n\n`
    + `La pièce sera marquée comme portant cette facture. ${enDouble}\n\n`
    + `${ceQuiSeCompte} La désignation se fige avec la pièce quand un exercice qui la porte est validé.`
}

/**
 * La confirmation du retrait de la désignation : elle NOMME la facture, et dit ce que défaire change — la pièce n'est plus
 * l'exemplaire — et ce que cela fait à ce qui se compte. Pour une facture qui n'est pas source, rien. Pour une facture SOURCE,
 * la pièce compte de nouveau, en plus de sa facture : la vente est comptée deux fois — la base ne le refuse pas (étapes VF6 et
 * VF7), la confirmation le dit. `autresPieces` : les noms des autres pièces qui portent la même facture quand le pont dit la
 * vente comptée plusieurs fois (null sinon). Défaire peut faire taire « Comptée deux fois » — quand la désignation était la
 * seule preuve qui relie la pièce à sa facture —, mais ne retire jamais le double compte.
 */
export function confirmationDuRetraitDeLaDesignation(
  nomFichier: string, facture: FactureProposee, autresPieces: readonly string[] | null,
): string {
  const double = autresPieces !== null && autresPieces.length > 0
  const doublee = autresPieces === null ? '' : autresPieces.map((n) => `« ${n} »`).join(', ')
  const source = facture.source_de_la_vente
  const ceQuiSeCompte = source
    ? `${enTete(nomDeLaFacture(facture))} est la source de sa vente, et la compte déjà : la désignation défaite, la pièce `
      + `comptera de nouveau dans ${LES_ETATS}, EN PLUS de la facture — la vente sera comptée deux fois.`
    : 'Défaire ne change rien à ce qui se compte.'
  const plusieurs = source
    ? `\n\nLa vente est aujourd’hui portée par plusieurs pièces : cette pièce et ${doublee} portent la même facture. Défaire `
      + 'la désignation peut faire taire « Comptée deux fois » — si elle était la seule preuve qui relie la pièce à sa '
      + 'facture —, alors que la vente sera comptée UNE FOIS DE PLUS : par cette pièce, en plus de la facture et de toute autre '
      + 'pièce qui n’est pas désignée. Il n’en faut garder qu’une par facture, désignée comme son exemplaire.'
    : `\n\nLa vente est aujourd’hui comptée plusieurs fois : cette pièce et ${doublee} portent la même facture. Défaire la `
      + 'désignation peut faire taire « Comptée deux fois » — si elle était la seule preuve qui relie la pièce à sa facture —, '
      + 'mais NE RETIRE PAS le double compte : les deux pièces continuent de compter la vente. Il n’en faut garder qu’une par '
      + 'facture.'
  return `Défaire la désignation : la pièce « ${nomFichier} » ne sera plus l’exemplaire de ${nomDeLaFacture(facture)} `
    + `(${descriptionDeLaFacture(facture)}) ?\n\n`
    + `La pièce reste au dossier, avec son fichier et ses montants. ${ceQuiSeCompte}`
    + (double ? plusieurs : '')
}

/**
 * Pourquoi le formulaire d'une pièce désignée ne s'enregistrerait pas (sa nature ne change pas, ni son dossier), sous les mots
 * de la garde — ou null. La règle est celle du module (`refusDeLaPieceDesignee`) ; seul le numéro peut manquer : la facture
 * désignée n'est pas dans la liste lue (pas encore revenue, lue en partie), et la phrase ne le prétend alors pas.
 */
export function refusDuFormulaireDeLaPiece(
  piece: PieceDesignable, typePiece: TypePiece, factures: readonly FactureProposee[] | null,
): string | null {
  const refus = refusDeLaPieceDesignee(piece, { type_piece: typePiece }, factures ?? [])
  if (refus === null) return null
  const designee = piece.facture_id ?? null
  if (designee !== null && (factures ?? []).some((f) => f.id === designee)) return refus.message
  return 'Cette pièce est l’exemplaire d’une facture émise, dont le numéro n’a pas pu être lu : elle reste une pièce de vente — '
    + 'défaire d’abord la désignation.'
}
