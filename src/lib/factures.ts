import { supabase } from './supabase'
import { formatDate, formatMoney } from './format'
import { calculerTotaux } from './montantsFacture'
import { mentionTva } from './statutTva'
import type { ArticleExoneration, FactureEmise, FactureLigne, StatutTva } from './types'

// Mentions légales par défaut, proposées à la création d'une facture puis librement modifiables avant
// validation — un point de départ raisonnable, pas une garantie de conformité exhaustive : la
// réglementation dépend du statut exact du client (professionnel/particulier, régime de TVA...), à
// ajuster au cas par cas par le cabinet, comme le reste de ce que l'appli propose sans jamais figer.
// La mention de TVA suit le STATUT du dossier (lib/statutTva.ts) : la franchise cite l'art. 293 B, une
// exonération l'article qui exonère. Elle proposait la franchise à tout dossier non assujetti, donc à un
// dossier de soins exonérés — c'était faux, et c'est le défaut qui a fait naître ce statut (ligne 28.5).
export function mentionsLegalesParDefaut(statut: StatutTva | null, article: ArticleExoneration | null): string {
  const lignes: string[] = []
  const mention = mentionTva(statut, article)
  if (mention) lignes.push(mention)
  lignes.push(
    "En cas de retard de paiement, une pénalité égale à trois fois le taux d'intérêt légal sera exigible, " +
    'ainsi qu\'une indemnité forfaitaire pour frais de recouvrement de 40 €.',
  )
  return lignes.join('\n')
}

// Le calcul des montants vit à part (montantsFacture.ts), sans le client Supabase : le générateur de la facture
// électronique (factureCii.ts) en a besoin, et un module de calcul ne l'importe jamais (CLAUDE.md).
export { calculerLigne, calculerTotaux, type LigneCalculee } from './montantsFacture'

export interface LigneAEnregistrer {
  designation: string
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
}

// Ce qui part d'une saisie : une ligne porte une désignation et une quantité positive. Une ligne qui n'en porte pas est
// écartée, et COMPTÉE quand elle porte quelque chose — une désignation, un prix : une remise saisie en quantité
// négative, ou un montant dont on a oublié la désignation, ne doit pas disparaître sans un mot. Une ligne neuve laissée
// vide ne compte pas.
export function lignesSaisies<T extends LigneAEnregistrer>(lignes: T[]): { valides: T[]; ecartees: number } {
  const part = (l: T) => l.designation.trim() !== '' && l.quantite > 0
  return {
    valides: lignes.filter(part),
    ecartees: lignes.filter((l) => !part(l) && (l.designation.trim() !== '' || l.prix_unitaire_ht !== 0)).length,
  }
}

// Enregistre l'en-tête, remplace les lignes et, si demandé, attribue le numéro et valide — le tout
// dans une seule transaction côté base (`enregistrer_facture`). Ces opérations étaient auparavant
// trois à cinq allers-retours indépendants : un échec au milieu laissait la facture à mi-chemin,
// lignes doublées ou numéro consommé sans être posé.
//
// Le numéro — F<année>-<numéro sur 4 chiffres> pour une facture, A<année>-<numéro> pour un avoir, deux séries
// indépendantes et chacune sans trou — est attribué par la base, dans la transaction qui valide, sur l'année de la
// date d'ÉMISSION : un document daté de décembre et validé en janvier reste dans la suite de son année. Son format
// vit côté base (`numero_facture_formate`) et nulle part ici.
//
// Les montants de l'en-tête sont ceux des lignes ENVOYÉES, jamais d'un autre jeu : la base les stocke tels quels
// (CLAUDE.md, « ce qui est déjà testé en TypeScript n'est pas réécrit en SQL »), donc un total calculé sur des
// lignes qu'on n'envoie pas ferait une facture dont l'en-tête contredit les lignes.
export async function enregistrerFacture(
  dossierId: string,
  factureId: string | null,
  entete: Record<string, unknown>,
  lignes: LigneAEnregistrer[],
  valider: boolean,
): Promise<{ id: string; numero: string | null }> {
  const { data, error } = await supabase.rpc('enregistrer_facture', {
    p_dossier_id: dossierId, p_facture_id: factureId, p_facture: entete, p_lignes: lignes, p_valider: valider,
  })
  if (error) throw new Error(error.message)
  const ligne = (data as { facture_id: string; numero: string | null }[] | null)?.[0]
  if (!ligne) throw new Error("L'enregistrement de la facture n'a rien renvoyé.")
  return { id: ligne.facture_id, numero: ligne.numero }
}

// ── L'AVOIR ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Un avoir corrige une facture VALIDÉE sans jamais la rouvrir (CLAUDE.md). Il s'enregistre d'un seul tenant par
// `enregistrer_facture` (migration mentions_de_la_facture) : son numéro de la série « A », l'avoir validé et ses lignes
// dans une transaction. L'écran le faisait en trois allers-retours — un numéro consommé, l'avoir inséré validé, puis ses
// lignes —, et un échec au milieu laissait un numéro perdu ou un avoir sans lignes. La base reprend de la facture
// d'origine ses parties et ce qu'elle dit de l'opération : l'appelant ne donne que la date, le motif, les mentions et
// les lignes qu'il crédite.

const centimes = (euros: number) => Math.round(euros * 100)
// Le négatif d'un montant, sans « −0 » : un zéro reste un zéro, à l'écran comme dans une comparaison.
const oppose = (euros: number) => (euros === 0 ? 0 : -euros)

// Ce que les avoirs d'une facture ont déjà crédité, en euros positifs — la somme que fait la base : les avoirs dont
// elle est l'origine, leurs montants étant stockés négatifs. En centimes entiers, pour qu'une somme de flottants ne
// laisse pas un centime à créditer là où il ne reste rien.
export function dejaCredite(
  origineId: string,
  factures: Pick<FactureEmise, 'type' | 'facture_origine_id' | 'montant_ttc'>[],
): number {
  let total = 0
  for (const f of factures) {
    if (f.type === 'avoir' && f.facture_origine_id === origineId) total += centimes(-f.montant_ttc)
  }
  return total / 100
}

// Ce que la base refuserait, dit avant le clic et dans son ordre (`enregistrer_facture`). `lignes` sont celles qu'on
// CRÉDITE, quantités positives : l'écran les saisit ainsi, `creerAvoir` les rend négatives. `credite` vaut null quand on
// ne sait pas ce que les autres avoirs de la facture ont crédité — la liste des factures lue en partie : la base en juge
// alors seule, plutôt qu'un plafond calculé sur une liste incomplète.
export function refusAvoir(
  origine: Pick<FactureEmise, 'type' | 'statut' | 'numero' | 'date_emission' | 'montant_ttc'>,
  dateEmission: string,
  lignes: LigneAEnregistrer[],
  credite: number | null,
): string | null {
  if (lignes.length === 0) return 'Au moins une ligne avec une quantité doit rester à créditer.'
  if (origine.type !== 'facture' || origine.statut !== 'validee') {
    return 'Un avoir corrige une facture validée, jamais un brouillon ni un autre avoir.'
  }
  if (!dateEmission) return "Indique la date d'émission de l'avoir."
  if (dateEmission < origine.date_emission) {
    return `Un avoir ne précède pas la facture qu'il corrige (émise le ${formatDate(origine.date_emission)}).`
  }
  if (lignes.some((l) => !(l.quantite > 0))) return 'Chaque ligne créditée porte une quantité positive.'
  const montant = centimes(calculerTotaux(lignes).montant_ttc)
  if (montant <= 0) return 'Un avoir crédite un montant : son total TTC doit être positif.'
  if (credite !== null) {
    const reste = centimes(origine.montant_ttc) - centimes(credite)
    if (montant > reste) {
      return `Cet avoir créditerait ${formatMoney(montant / 100)} : la facture ${origine.numero ?? ''} n'a plus que ` +
        `${formatMoney(Math.max(reste, 0) / 100)} à créditer.`
    }
  }
  return null
}

// L'avoir, enregistré et validé d'un seul tenant. Ses montants et ses lignes sont stockés NÉGATIFS (voir
// FactureEmise.type) : sommer les montants d'un dossier annule l'avoir sans cas particulier. L'en-tête est le total
// des lignes envoyées, comme pour une facture.
export async function creerAvoir(
  dossierId: string,
  origineId: string,
  avoir: { dateEmission: string; motif: string; mentionsLegales: string; lignes: LigneAEnregistrer[] },
): Promise<{ id: string; numero: string | null }> {
  const totaux = calculerTotaux(avoir.lignes)
  return enregistrerFacture(
    dossierId,
    null,
    {
      type: 'avoir',
      facture_origine_id: origineId,
      date_emission: avoir.dateEmission,
      notes: avoir.motif.trim() || null,
      mentions_legales: avoir.mentionsLegales.trim() || null,
      montant_ht: oppose(totaux.montant_ht),
      montant_tva: oppose(totaux.montant_tva),
      montant_ttc: oppose(totaux.montant_ttc),
    },
    avoir.lignes.map((l) => ({
      designation: l.designation, quantite: oppose(l.quantite), prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva,
    })),
    true,
  )
}

// Représentation triée par ordre d'affichage — les lignes arrivent de Supabase déjà triées par la
// requête (order('ordre')), mais toute fonction qui les reçoit d'ailleurs (ex. un futur export) ne
// doit pas supposer cet ordre déjà garanti.
export function trierLignes<T extends Pick<FactureLigne, 'ordre'>>(lignes: T[]): T[] {
  return [...lignes].sort((a, b) => a.ordre - b.ordre)
}
