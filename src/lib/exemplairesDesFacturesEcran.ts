import { formatDate, formatMoney } from './format'
import { refusDeLaPieceDesignee, REFUS_GARDE_JUMELLE, type PieceDesignable } from './exemplairesDesFactures'
import type { FactureProposee } from './exemplairesDesFacturesLecture'
import type { LigneDuJournal } from './marquesDeLaPiece'
import type { TypePiece } from './types'

// LES MOTS DE LA SECTION « CE QUE CETTE PIÈCE EST » (ligne 28.6, chantier EC-Q3 : étape VF1b, puis VF3b3 et VF6c) : le choix de
// la facture, les confirmations des quatre gestes — désigner (ou remplacer), défaire, déclarer la pièce vente hors des
// factures de l'application, retirer la déclaration —, les phrases de ce que la pièce est, son journal, et le refus du
// formulaire d'une pièce désignée ou déclarée. Un module PUR, comme le reste de la règle (lib/exemplairesDesFactures.ts,
// dont les refus se disent avant le clic, sous les mots de la base) : l'écran (pages/dossier/ExemplaireDeLaFacture.tsx) ne
// compose aucune phrase, et un test les confronte à ce que la confirmation doit NOMMER — la pièce, la facture — et à ce
// qu'elle doit dire que le geste change à ce qui se compte.

export const TITRE_DE_LA_SECTION = 'Ce que cette pièce est'

/** « la facture F2026-0007 » ou « l'avoir A2026-0001 » : la nature de ce que la pièce porte. */
export function nomDeLaFacture(f: Pick<FactureProposee, 'type' | 'numero'>): string {
  const numero = f.numero ?? '(sans numéro)'
  return f.type === 'avoir' ? `l’avoir ${numero}` : `la facture ${numero}`
}

/** Ce qui désigne la facture à qui la regarde : son client, son montant TTC (un avoir est négatif) et sa date d'émission. */
export function descriptionDeLaFacture(f: Pick<FactureProposee, 'tiers_nom' | 'montant_ttc' | 'date_emission'>): string {
  return `${f.tiers_nom}, ${formatMoney(f.montant_ttc)} TTC, émise le ${formatDate(f.date_emission)}`
}

/** « figée » ou « figé » : l'accord avec la facture ou l'avoir. */
function figeeOuFige(f: Pick<FactureProposee, 'type'>): string {
  return f.type === 'avoir' ? 'figé' : 'figée'
}

/**
 * La ligne du choix : de quoi retrouver la facture sans en connaître le numéro — et, pour une facture source que la
 * validation d'un exercice fige (`gel`, `exerciceFigeantLaFactureSource` ; étape VF7e), qu'elle l'est : elle ne reçoit plus
 * qu'une première désignation.
 */
export function ligneDuChoix(
  f: Pick<FactureProposee, 'type' | 'numero' | 'tiers_nom' | 'montant_ttc' | 'date_emission'>, gel: number | null,
): string {
  return `${f.type === 'avoir' ? 'Avoir' : 'Facture'} ${f.numero ?? '(sans numéro)'} — ${formatDate(f.date_emission)} — ${f.tiers_nom} — ${formatMoney(f.montant_ttc)}`
    + (gel === null ? '' : ` — ${figeeOuFige(f)} par la validation de l’exercice ${gel}`)
}

// CE QUI SE COMPTE DÉPEND DE LA FACTURE (étape VF3b3). Depuis que la 2035, la CA3, la situation intermédiaire et l'estimation
// lisent les ventes facturées (lib/ventesFacturees.ts), une facture SOURCE de sa vente compte elle-même, et la pièce désignée
// comme son exemplaire ne compte plus. Désigner l'exemplaire d'une facture source retire donc la pièce de ce qui se compte ;
// défaire l'y remet, EN PLUS de la facture : la vente est comptée deux fois. Pour une facture qui n'est pas source, rien ne
// change, ni dans un sens ni dans l'autre. Une pièce déclarée vente hors des factures de l'application (étape VF6) compte
// comme une vente — et si c'était le PDF d'une facture de l'application, la vente compterait deux fois. Seule une pièce
// VALIDÉE compte (lib/declaration2035.ts) : dans un dossier basculé, une pièce de vente ne se valide que désignée ou déclarée
// (G3), et une pièce validée ne perd plus sa marque, elle la remplace (VF6-Q1).

/** Les états qui comptent une vente, nommés une fois pour toutes les phrases. */
const LES_ETATS = 'la 2035, la CA3, la situation intermédiaire et l’estimation'

/** « La facture F… » ou « L'avoir A… » : en tête de phrase. */
function enTete(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1)
}

/**
 * Le paragraphe de la fiche d'une pièce de vente que rien ne marque, dans un dossier qui n'a PAS basculé, avant tout choix :
 * ce qu'est un exemplaire, ce que la désignation change à la marque de la pièce, et ce qu'elle change à ce qui se compte —
 * selon que la facture est source de sa vente ou non, les deux cas, puisqu'aucune facture n'est encore choisie.
 */
export const PARAGRAPHE_DE_LA_DESIGNATION = 'Cette pièce de vente est peut-être l’exemplaire d’une facture émise dans l’application : '
  + 'l’original revenu de la plateforme du client, ou le PDF déposé. La désigner la relie à sa facture ; si une autre pièce '
  + 'porte déjà la même facture, la vente s’affiche « Comptée deux fois ». '
  + `Pour une facture source de sa vente, la pièce désignée cesse de compter dans ${LES_ETATS} : c’est la facture qui compte `
  + 'la vente. Pour une autre facture, désigner ne change rien à ce qui se compte.'

/**
 * Le paragraphe de la fiche d'une pièce de vente que rien ne marque, dans un dossier BASCULÉ : les deux marques, ce que
 * chacune fait compter, et que la validation attend l'une des deux (G3).
 */
export const PARAGRAPHE_D_UN_DOSSIER_BASCULE = 'Dans ce dossier, les factures émises sont la source de leurs ventes : une '
  + 'pièce de vente se valide désignée exemplaire de sa facture, ou déclarée vente hors des factures de l’application — '
  + 'l’une ou l’autre, avant de la valider. Exemplaire d’une facture source de sa vente (l’original revenu de la plateforme '
  + `du client, ou le PDF déposé), la pièce ne compte pas dans ${LES_ETATS} : c’est la facture qui compte la vente. `
  + 'Déclarée vente hors des factures de l’application (une prestation facturée ailleurs, une recette sans facture), elle '
  + 'compte comme une vente.'

/**
 * Ce que le pont prouve d'une pièce d'un dossier basculé, sans sa désignation : la facture qu'il reconnaît, la seule que la
 * pièce peut désigner. Il la PROPOSE — rien n'est choisi d'avance. `facture` nulle : la liste lue ne la contient pas.
 */
export function phraseDuPont(facture: FactureProposee | null): string {
  const nom = facture === null ? 'une facture émise que la liste lue ne contient pas' : nomDeLaFacture(facture)
  return `Ses preuves (son flux, l’identifiant de Super PDP ou son identité) en font ${nom}, émise dans l’application et `
    + 'revenue comme pièce : elle ne se désigne l’exemplaire que de celle-ci, et ne se déclare pas hors des factures de '
    + 'l’application.'
}

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
 * La ligne de la fiche d'une pièce déclarée vente hors des factures de l'application. Hors d'un dossier basculé (un dossier
 * dont la bascule est redescendue avant sa première facture source), la déclaration ne dit rien, et la phrase le dit.
 */
export function phraseDeLaPieceDeclaree(dossierBascule: boolean): string {
  return dossierBascule
    ? 'Cette pièce est déclarée vente hors des factures de l’application : aucune facture validée de l’application n’est la '
      + `facture de cette vente. Validée, elle compte comme une vente dans ${LES_ETATS}.`
    : 'Cette pièce est déclarée vente hors des factures de l’application. Les factures de ce dossier ne sont pas la source '
      + 'de leurs ventes : la déclaration n’y change rien, et la pièce compte comme toute pièce de vente.'
}

/** Ce que la pièce était avant le geste : rien, l'exemplaire d'une facture (lue), ou une vente déclarée hors des factures. */
export type CeQuElleEtait = { genre: 'rien' } | { genre: 'designee'; facture: FactureProposee } | { genre: 'declaree' }

/**
 * La confirmation de la désignation — ou de son REMPLACEMENT (VF6-Q1 : une désignation à une autre facture, ou une
 * déclaration, se remplace d'un seul geste) : elle NOMME la pièce et la facture (numéro, client, montant TTC), ce que la
 * pièce cesse d'être, et dit ce que le geste change à ce qui se compte, selon la facture qu'elle prend ET celle qu'elle
 * quitte. Le gel fige la désignation : l'exercice validé qui porte une écriture de la pièce, ou — pour une facture source,
 * dont l'exemplaire ne porte aucune écriture — celui de la facture (étape VF7e). `gelDeLaFacture` : l'exercice validé qui fige
 * déjà la facture choisie (`exerciceFigeantLaFactureSource`), nul sinon ; une telle facture ne reçoit qu'une première
 * désignation (VF7-Q1, option B), aussitôt figée, et la confirmation le dit.
 */
export function confirmationDeLaDesignation(
  nomFichier: string, facture: FactureProposee, avant: CeQuElleEtait, gelDeLaFacture: number | null,
): string {
  const quittee = avant.genre === 'designee' ? avant.facture : null
  const remplacement = avant.genre === 'designee'
    ? `Elle ne sera plus l’exemplaire de ${nomDeLaFacture(avant.facture)} (${descriptionDeLaFacture(avant.facture)}) : la `
      + 'désignation est remplacée d’un seul geste.\n\n'
    : avant.genre === 'declaree'
      ? 'Elle ne sera plus déclarée vente hors des factures de l’application : la déclaration est remplacée d’un seul geste.\n\n'
      : ''
  let ceQuiSeCompte: string
  if (facture.source_de_la_vente && quittee?.source_de_la_vente) {
    ceQuiSeCompte = `${enTete(nomDeLaFacture(facture))} est la source de sa vente, comme ${nomDeLaFacture(quittee)} : la pièce, `
      + `qui ne comptait pas, ne comptera pas davantage ; chacune des deux factures compte sa propre vente dans ${LES_ETATS}.`
  } else if (facture.source_de_la_vente) {
    ceQuiSeCompte = `${enTete(nomDeLaFacture(facture))} est la source de sa vente : désignée comme son exemplaire, la pièce cessera de compter `
      + `dans ${LES_ETATS}, où la vente ne sera plus comptée que par ${nomDeLaFacture(facture)}.`
  } else if (quittee?.source_de_la_vente) {
    ceQuiSeCompte = `${enTete(nomDeLaFacture(quittee))} est la source de sa vente, et la compte : la pièce, qui ne comptait pas, `
      + `comptera de nouveau dans ${LES_ETATS}, comme la vente de ${nomDeLaFacture(facture)} — si elle était bien l’exemplaire `
      + `de ${nomDeLaFacture(quittee)}, cette vente serait comptée deux fois.`
  } else {
    ceQuiSeCompte = 'Désigner ne change rien à ce qui se compte aujourd’hui.'
  }
  const enDouble = facture.source_de_la_vente
    // Le pont ne connaît pas encore la source (étape VF6e) : il dit « Comptée deux fois » dès que deux pièces portent la
    // facture. Pour une facture source, ce qui compte de trop est une pièce qui n'est PAS désignée.
    ? 'Si une autre pièce porte déjà la même facture, la vente s’affichera « Comptée deux fois » : une pièce de cette facture '
      + 'qui n’est pas désignée compte encore, en plus de la facture.'
    : 'Si une autre pièce porte déjà la même facture, la vente s’affichera « Comptée deux fois » : une vente ne se compte '
      + 'qu’une fois, il n’en faut garder qu’une.'
  const gel = gelDeLaFacture !== null
    ? `${enTete(nomDeLaFacture(facture))} est ${figeeOuFige(facture)} par la validation de l’exercice ${gelDeLaFacture} : cette `
      + 'première désignation se fige aussitôt — elle ne se changera ni ne se retirera.'
    : facture.source_de_la_vente
      ? `La désignation se fige quand l’exercice de ${nomDeLaFacture(facture)} est validé.`
      : 'La désignation se fige avec la pièce quand un exercice qui la porte est validé.'
  return `Désigner la pièce « ${nomFichier} » comme l’exemplaire de ${nomDeLaFacture(facture)} (${descriptionDeLaFacture(facture)}) ?\n\n`
    + remplacement
    + `La pièce sera marquée comme portant cette facture. ${enDouble}\n\n`
    + `${ceQuiSeCompte} ${gel}`
}

/**
 * La confirmation du retrait de la désignation : elle NOMME la facture, et dit ce que défaire change — la pièce n'est plus
 * l'exemplaire — et ce que cela fait à ce qui se compte.
 *  - Dans un dossier BASCULÉ, seule une pièce à valider se défait (VF6-Q1) : elle ne compte pas encore, et ne se validera
 *    qu'à nouveau désignée ou déclarée (G3) ; déclarée alors qu'elle est l'exemplaire d'une facture source, elle compterait
 *    la vente une seconde fois — la confirmation le dit.
 *  - Ailleurs : pour une facture qui n'est pas source, rien ; pour une facture SOURCE, la pièce compte de nouveau, en plus de
 *    sa facture. `autresPieces` : les noms des autres pièces qui portent la même facture quand le pont dit la vente comptée
 *    plusieurs fois (null sinon). Défaire peut faire taire « Comptée deux fois » — quand la désignation était la seule
 *    preuve qui relie la pièce à sa facture —, mais ne retire jamais le double compte.
 */
export function confirmationDuRetraitDeLaDesignation(
  nomFichier: string, facture: FactureProposee, autresPieces: readonly string[] | null, dossierBascule: boolean,
): string {
  const tete = `Défaire la désignation : la pièce « ${nomFichier} » ne sera plus l’exemplaire de ${nomDeLaFacture(facture)} `
    + `(${descriptionDeLaFacture(facture)}) ?\n\nLa pièce reste au dossier, avec son fichier et ses montants. `
  if (dossierBascule) {
    return tete + 'Elle est à valider, et ne compte pas encore. Dans ce dossier, elle ne se validera qu’à nouveau désignée '
      + 'exemplaire d’une facture émise, ou déclarée vente hors des factures de l’application.'
      + (facture.source_de_la_vente
        ? ` ${enTete(nomDeLaFacture(facture))} est la source de sa vente, et la compte déjà : si la pièce est bien son `
          + 'exemplaire, déclarée hors des factures elle compterait la vente une seconde fois.'
        : '')
  }
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
  return tete + ceQuiSeCompte + (double ? plusieurs : '')
}

/**
 * La confirmation de la déclaration : elle NOMME la pièce — et la facture dont elle cesse d'être l'exemplaire, quand elle
 * remplace une désignation (VF6-Q1) —, dit ce que la déclaration affirme, et ce qu'elle fait compter : une vente, « et si
 * c'était le PDF d'une facture de l'application, la vente compterait deux fois » ; pour l'exemplaire d'une facture source
 * qu'elle quitte, c'est le cas.
 */
export function confirmationDeLaDeclaration(nomFichier: string, avant: Exclude<CeQuElleEtait, { genre: 'declaree' }>): string {
  const quittee = avant.genre === 'designee' ? avant.facture : null
  return `Déclarer la pièce « ${nomFichier} » vente hors des factures de l’application ?\n\n`
    + (quittee === null ? '' : `Elle ne sera plus l’exemplaire de ${nomDeLaFacture(quittee)} (${descriptionDeLaFacture(quittee)}) : `
      + 'la désignation est remplacée d’un seul geste.\n\n')
    + 'La déclaration dit qu’aucune facture validée de l’application n’est la facture de cette vente — une prestation '
    + `facturée ailleurs, une recette sans facture. Validée, la pièce compte comme une vente dans ${LES_ETATS} ; et si c’était `
    + 'le PDF d’une facture de l’application, la vente compterait deux fois : par la facture et par la pièce.'
    + (quittee?.source_de_la_vente
      ? ` ${enTete(nomDeLaFacture(quittee))} est la source de sa vente, et la compte déjà : si la pièce est bien son exemplaire, `
        + 'la vente sera comptée deux fois.'
      : '')
    + '\n\nLa déclaration se fige avec la pièce quand un exercice qui la porte est validé.'
}

/**
 * La confirmation du retrait de la déclaration : elle NOMME la pièce et dit ce que le retrait change. Dans un dossier
 * basculé, seule une pièce à valider se retire (VF6-Q1) : elle ne compte pas encore, et ne se validera qu'à nouveau déclarée
 * ou désignée (G3). Ailleurs, la déclaration ne disait rien.
 */
export function confirmationDuRetraitDeLaDeclaration(nomFichier: string, dossierBascule: boolean): string {
  return `Retirer la déclaration : la pièce « ${nomFichier} » ne sera plus une vente hors des factures de l’application ?\n\n`
    + 'La pièce reste au dossier, avec son fichier et ses montants. '
    + (dossierBascule
      ? 'Elle est à valider, et ne compte pas encore : ce retrait ne change rien à ce qui se compte aujourd’hui. Dans ce '
        + 'dossier, elle ne se validera qu’à nouveau déclarée, ou désignée exemplaire d’une facture émise.'
      : 'Les factures de ce dossier ne sont pas la source de leurs ventes : la déclaration n’y disait rien, et la retirer ne '
        + 'change rien à ce qui se compte.')
}

// ── Le journal de la pièce ────────────────────────────────────────────────────────────────────────────────────────────

/** Le geste d'une ligne du journal, en mots : la facture nommée quand la liste lue la porte, jamais un numéro inventé. */
export function phraseDuGeste(ligne: Pick<LigneDuJournal, 'geste' | 'facture_id'>, factures: readonly FactureProposee[]): string {
  const facture = ligne.facture_id === null ? undefined : factures.find((f) => f.id === ligne.facture_id)
  const deLaFacture = facture === undefined ? 'd’une facture que la liste lue ne contient pas' : `de ${nomDeLaFacture(facture)}`
  switch (ligne.geste) {
    case 'designation': return `Désignée exemplaire ${deLaFacture}`
    case 'retrait_designation': return `N’est plus l’exemplaire ${deLaFacture}`
    case 'declaration': return 'Déclarée vente hors des factures de l’application'
    case 'retrait_declaration': return 'Déclaration retirée'
  }
}

/** Le moment d'un geste : un instant, dit au jour de qui le regarde (`formatDate` sur un horodatage). */
export function dateDuGeste(ligne: Pick<LigneDuJournal, 'fait_le'>): string {
  return formatDate(ligne.fait_le)
}

/**
 * Les gestes restés dans un autre dossier (VF6B-Q1) : la pièce en vient, et les lignes de son journal, qui ne se réécrivent
 * pas, n'ont pas changé de dossier avec elle. `nom` nul : le nom de ce dossier n'a pas pu être lu, la phrase n'en invente pas.
 */
export function phraseDuJournalResteAilleurs(gestes: number, nom: string | null): string {
  const ou = nom === null ? 'un autre dossier' : `le dossier « ${nom} »`
  return `${gestes === 1 ? 'Un geste' : `${gestes} gestes`} du journal de cette pièce ${gestes === 1 ? 'est resté' : 'sont restés'} `
    + `dans ${ou}, d’où elle vient : une ligne du journal ne change pas de dossier, et ${gestes === 1 ? 'il s’y lit' : 'ils s’y lisent'}.`
}

/**
 * Le journal illisible : la fiche le dit, et n'affirme rien — ni qui a marqué la pièce, ni qu'aucun geste n'est resté dans
 * un autre dossier.
 */
export function phraseDuJournalIllisible(motif: string): string {
  return `Le journal de cette pièce n’a pas pu être lu en entier (${motif}) : on ne sait pas qui l’a désignée ou déclarée, ni `
    + 'si des gestes sont restés dans un autre dossier.'
}

/**
 * Pourquoi le formulaire d'une pièce désignée ou déclarée ne s'enregistrerait pas (sa nature ne change pas), sous les mots de
 * la garde — ou null. La règle est celle du module (`refusDeLaPieceDesignee`, la garde étendue à la déclaration) ; seul le
 * numéro peut manquer : la facture désignée n'est pas dans la liste lue (pas encore revenue, lue en partie), et la phrase ne
 * le prétend alors pas.
 */
export function refusDuFormulaireDeLaPiece(
  piece: PieceDesignable & { vente_hors_des_factures: boolean }, typePiece: TypePiece, factures: readonly FactureProposee[] | null,
): string | null {
  const designee = piece.facture_id ?? null
  if (designee === null) {
    if (!piece.vente_hors_des_factures || typePiece === 'vente') return null
    return REFUS_GARDE_JUMELLE.find((r) => r.cle === 'declaree_change_de_nature')?.modele ?? null
  }
  const refus = refusDeLaPieceDesignee(piece, { type_piece: typePiece }, factures ?? [])
  if (refus === null) return null
  if ((factures ?? []).some((f) => f.id === designee)) return refus.message
  return 'Cette pièce est l’exemplaire d’une facture émise, dont le numéro n’a pas pu être lu : elle reste une pièce de vente — '
    + 'défaire d’abord la désignation.'
}
