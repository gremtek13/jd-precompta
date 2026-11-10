// LA FACTURE À UN CLIENT ÉTABLI HORS DE FRANCE, À L'ÉCRAN (ligne 28.5, étape e7b). Ce que le formulaire de la facture (les
// deux espaces) saisit du pays où le client est établi, de son numéro de TVA et du régime de l'opération, ce qu'il en envoie
// à `enregistrer_facture`, ce qu'il en refuse avant le clic, ce que la confirmation en nomme, et ce que l'aperçu d'une
// facture figée en imprime. Les RÈGLES ne sont pas ici : chaque refus, chaque mention, chaque libellé vient de
// `lib/factureInternationale.ts`, qui redit la garde de la migration `facture_internationale` (PRÉPARÉE, PAS APPLIQUÉE).
// Ce module ne fait qu'assembler la saisie TELLE QU'ELLE PART et la lui donner.
//
// Drapeau baissé (`FACTURE_INTERNATIONALE_EXPORTEE`, lu À CHAQUE APPEL, jamais copié dans une constante d'ici) : aucune clé
// ne part, aucun refus ne se dit, rien ne s'imprime — l'écran exactement comme hier.
//
// Le récit : HISTORIQUE.md, « LA FACTURE À UN CLIENT ÉTABLI HORS DE FRANCE, À L'ÉCRAN (E7B, LIGNE 28.5) ».
import {
  FACTURE_INTERNATIONALE_EXPORTEE, LIBELLES_DES_REGIMES, REGIMES_INTERNATIONAUX, horsDeLaTvaFrancaise, mentionDuRegime,
  refusDeLaFactureInternationale, refusDeLaForme, refusDeLaMentionDuDossier,
} from './factureInternationale'
import type { FactureEmise, NatureOperation, RegimeInternational, StatutTva, TypeClient } from './types'

// La saisie, en texte de champ.
export interface SaisieInternationaleEcran {
  pays: string
  numeroTva: string
  regime: RegimeInternational | ''
}

export const SAISIE_INTERNATIONALE_VIDE: SaisieInternationaleEcran = { pays: '', numeroTva: '', regime: '' }

// Ce qui part, les trois colonnes de la migration.
export interface InternationaleQuiPart {
  pays: string | null
  numeroTva: string | null
  regime: RegimeInternational | null
}

const RIEN: InternationaleQuiPart = { pays: null, numeroTva: null, regime: null }

/** Le brouillon rouvert : ses trois colonnes, drapeau levé ; vide sinon (une facture d'avant, ou la migration absente). */
export function saisieInternationaleLue(f: Pick<FactureEmise, 'client_pays' | 'client_numero_tva' | 'regime_international'> | null): SaisieInternationaleEcran {
  if (!FACTURE_INTERNATIONALE_EXPORTEE || f == null) return SAISIE_INTERNATIONALE_VIDE
  return { pays: f.client_pays ?? '', numeroTva: f.client_numero_tva ?? '', regime: f.regime_international ?? '' }
}

// Le bloc s'ouvre pour les deux types qu'un client établi hors de France peut avoir (le quatrième refus de la garde) : une
// entreprise établie hors de France, ou un particulier, qui peut l'être. Le numéro de TVA, à l'entreprise seule.
export function internationaleOuverte(typeClient: TypeClient | '' | null): boolean {
  return FACTURE_INTERNATIONALE_EXPORTEE && (typeClient === 'etranger' || typeClient === 'non_assujetti')
}
export function numeroDeTvaOuvert(typeClient: TypeClient | '' | null): boolean {
  return internationaleOuverte(typeClient) && typeClient === 'etranger'
}

// On tape un numéro de TVA avec des espaces, et en minuscules : il part sans eux, en capitales, et c'est CETTE valeur que
// les refus jugent. Rien d'autre n'est retouché (un point, un tiret restent, et la forme les refuse en le disant).
const enCapitalesSansBlanc = (texte: string) => texte.replace(/\s/g, '').toUpperCase()

/** Ce qui part : un champ caché par le type du client repart à nul, dans la même écriture (une clé absente garderait la
 * valeur d'hier en base). */
export function internationaleQuiPart(s: SaisieInternationaleEcran, typeClient: TypeClient | '' | null): InternationaleQuiPart {
  if (!internationaleOuverte(typeClient)) return RIEN
  const pays = enCapitalesSansBlanc(s.pays)
  const numero = numeroDeTvaOuvert(typeClient) ? enCapitalesSansBlanc(s.numeroTva) : ''
  return { pays: pays || null, numeroTva: numero || null, regime: s.regime || null }
}

/** Les clés de `p_facture` : aucune, drapeau baissé (la fonction d'hier ne les connaît pas) ; les trois, toujours, levé. */
export function champsInternationaux(qp: InternationaleQuiPart):
  { client_pays?: string | null; client_numero_tva?: string | null; regime_international?: RegimeInternational | null } {
  if (!FACTURE_INTERNATIONALE_EXPORTEE) return {}
  return { client_pays: qp.pays, client_numero_tva: qp.numeroTva, regime_international: qp.regime }
}

/** Une opération que la TVA française ne taxe pas, telle que la saisie part : drapeau baissé, jamais. */
export function horsTvaQuiPart(qp: InternationaleQuiPart): boolean {
  return FACTURE_INTERNATIONALE_EXPORTEE && horsDeLaTvaFrancaise(qp.regime)
}

export interface InternationaleAJuger {
  qp: InternationaleQuiPart
  typeClient: TypeClient | null
  nature: NatureOperation | null
  // Le statut de TVA du dossier, que la validation figera.
  statutTva: StatutTva | null
  // Le numéro de TVA que la validation figera (`numero_tva_imprime` du jugement des mentions figées) ; `undefined` tant que
  // ce jugement n'est pas là — la validation est alors retenue par lui, et le refus qui le lit ne se dit pas à faux.
  numeroTvaDuVendeur: string | null | undefined
  montantTva: number
  tauxDesLignes: readonly number[]
  // La mention de TVA du dossier (lib/statutTva.ts, `mentionTva`), celle que la garde compare.
  mentionDuDossier: string | null
  mentionsLegales: string
}

export interface JugementInternational {
  // Les contraintes de forme (23514 sans mots) : ni le brouillon ni la validation ne partent.
  refusDeLEnregistrement: string | null
  // Le premier refus du bloc E7A de la garde, puis celui de la mention du dossier : la validation ne part pas.
  refusDeLaValidation: string | null
}

const AUCUN: JugementInternational = { refusDeLEnregistrement: null, refusDeLaValidation: null }

/** Les refus que la base opposerait, sur la saisie telle qu'elle part, dans l'ordre de la garde et sous ses mots. */
export function jugementInternational(v: InternationaleAJuger): JugementInternational {
  if (!FACTURE_INTERNATIONALE_EXPORTEE) return AUCUN
  const forme = refusDeLaForme(v.qp.pays, v.qp.numeroTva)
  if (forme) return { refusDeLEnregistrement: forme, refusDeLaValidation: forme }
  const garde = v.numeroTvaDuVendeur === undefined ? null : refusDeLaFactureInternationale({
    typeClient: v.typeClient, pays: v.qp.pays, numeroTva: v.qp.numeroTva, regime: v.qp.regime, nature: v.nature,
    statutTva: v.statutTva, numeroTvaDuVendeur: v.numeroTvaDuVendeur, montantTva: v.montantTva, tauxDesLignes: v.tauxDesLignes,
  })
  return {
    refusDeLEnregistrement: null,
    refusDeLaValidation: garde ?? refusDeLaMentionDuDossier(v.qp.regime, v.mentionDuDossier, v.mentionsLegales),
  }
}

// Le libellé d'une option : le régime tel que les refus le nomment, sans son article, une capitale en tête.
export const OPTIONS_DES_REGIMES: readonly { valeur: RegimeInternational; libelle: string }[] = REGIMES_INTERNATIONAUX.map((r) => {
  const sansArticle = LIBELLES_DES_REGIMES[r].replace(/^une /, '')
  return { valeur: r, libelle: sansArticle.charAt(0).toUpperCase() + sansArticle.slice(1) }
})

/** Ce que la facture imprimera du régime, dit sous le choix : sa mention, ou celle du dossier pour une opération taxable
 * en France. Nul sans régime. */
export function mentionDuRegimeDite(regime: RegimeInternational | null): string | null {
  if (regime == null) return null
  const mention = mentionDuRegime(regime)
  return mention == null
    ? 'La facture imprimera la mention de TVA du dossier, comme une facture en France.'
    : `La facture imprimera « ${mention} »`
}

/** Le paragraphe de la confirmation qui NOMME ce que la validation figera de ces trois colonnes ; nul quand aucune ne part. */
export function confirmationInternationale(qp: InternationaleQuiPart): string | null {
  if (!FACTURE_INTERNATIONALE_EXPORTEE || (qp.pays == null && qp.numeroTva == null && qp.regime == null)) return null
  const morceaux = [
    qp.pays ? `le pays du client, ${qp.pays}` : null,
    qp.numeroTva ? `son numéro de TVA, ${qp.numeroTva}` : null,
    qp.regime ? `le régime de l'opération, ${LIBELLES_DES_REGIMES[qp.regime]}` : null,
  ].filter((m): m is string => m != null)
  const mention = mentionDuRegime(qp.regime)
  const imprime = qp.regime == null ? '' : mention == null
    ? ', sous la mention de TVA du dossier'
    : `, sous la mention « ${mention} »`
  return `Elle figera aussi ${morceaux.join(', ')}${imprime}.`
}

export interface ImpressionInternationale {
  pays: string | null
  numeroTva: string | null
  // La mention du régime ; nulle pour une opération taxable en France, qui imprime celle du dossier dans ses mentions légales.
  mention: string | null
}

/** Ce qu'une facture FIGÉE imprime de ces trois colonnes, des seules colonnes figées ; nul pour une facture d'avant, un
 * brouillon, une facture qui n'en porte aucune, ou drapeau baissé : l'aperçu reste celui d'hier. */
export function ceQueLaFactureInternationaleImprime(
  f: Pick<FactureEmise, 'mentions_figees' | 'client_pays' | 'client_numero_tva' | 'regime_international'>,
): ImpressionInternationale | null {
  if (!FACTURE_INTERNATIONALE_EXPORTEE || f.mentions_figees !== true) return null
  const pays = f.client_pays ?? null
  const numeroTva = f.client_numero_tva ?? null
  const regime = f.regime_international ?? null
  if (pays == null && numeroTva == null && regime == null) return null
  return { pays, numeroTva, mention: mentionDuRegime(regime) }
}
