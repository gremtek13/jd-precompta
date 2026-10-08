import { donneesDeLaFacture, refusEmission, type LigneCii } from './factureCii'
import { motifExoneration, refusTauxPositif } from './statutTva'
import type { ArticleExoneration, FactureEmise, MentionsFacture, NatureOperation, StatutTva, TypeClient } from './types'

// LES MENTIONS DE LA FACTURE ÉLECTRONIQUE, TELLES QUE LE FORMULAIRE LES SAISIT (ligne 28.5, étape c, quatrième temps ;
// pages/dossier/FactureFormModal.tsx). Elles vivent en base depuis le premier temps (migration mentions_de_la_facture) :
// à qui la facture est adressée, le SIREN et l'adresse de facturation électronique du client, le code service et le
// numéro d'engagement d'un organisme public, la catégorie de l'opération, sa date ou sa période, l'adresse de livraison
// des biens. L'option pour les débits ne se saisit pas : la base la fige à la validation, telle que le dossier la porte.
//
// Le module dit trois choses, sans client Supabase : ce que la BASE refuserait (ses contraintes, dites avant le clic —
// `refusDesMentions`), ce qu'on enregistre (`mentionsAEnregistrer`, qui remet à nul ce qui est devenu sans objet dans la
// même écriture), et ce qui empêcherait la facture, une fois validée, de partir par une plateforme agréée
// (`apercuDeTransmission`) — le jugement même que portent les fonctions qui la transmettent, puisqu'une facture validée
// ne se corrige plus que par un avoir.

// La date de l'opération (CGI, ann. II, art. 242 nonies A, I, 10°) : celle de la facture, un autre jour, ou une période.
export type PrestationSaisie = 'facture' | 'date' | 'periode'

export interface SaisieMentions {
  typeClient: TypeClient | ''
  siren: string
  adresseElectronique: string
  codeService: string
  numeroEngagement: string
  nature: NatureOperation | ''
  prestation: PrestationSaisie
  datePrestation: string
  periodeDebut: string
  periodeFin: string
  // Les biens sont livrés ailleurs qu'à l'adresse du client (7° bis).
  livraisonAilleurs: boolean
  livraisonAdresse: string
  livraisonCodePostal: string
  livraisonVille: string
  livraisonPays: string
}

// Le pays d'une adresse de livraison, quand on en ouvre une : la France, que l'on corrige au besoin.
export const PAYS_PAR_DEFAUT = 'FR'

// La saisie d'un brouillon, depuis ce que la base en garde ; vide pour une facture neuve. Une facture d'avant ces
// mentions les a nulles : rien n'est deviné.
export function saisieDesMentions(f: FactureEmise | null): SaisieMentions {
  const livraison = f?.livraison_adresse != null
  return {
    typeClient: f?.type_client ?? '',
    siren: f?.tiers_siren ?? '',
    adresseElectronique: f?.tiers_adresse_electronique ?? '',
    codeService: f?.code_service ?? '',
    numeroEngagement: f?.numero_engagement ?? '',
    nature: f?.nature_operation ?? '',
    prestation: f?.periode_debut != null ? 'periode' : f?.date_prestation != null ? 'date' : 'facture',
    datePrestation: f?.date_prestation ?? '',
    periodeDebut: f?.periode_debut ?? '',
    periodeFin: f?.periode_fin ?? '',
    livraisonAilleurs: livraison,
    livraisonAdresse: f?.livraison_adresse ?? '',
    livraisonCodePostal: f?.livraison_code_postal ?? '',
    livraisonVille: f?.livraison_ville ?? '',
    livraisonPays: livraison ? f?.livraison_pays ?? PAYS_PAR_DEFAUT : PAYS_PAR_DEFAUT,
  }
}

// Ce que chaque choix ouvre à la saisie. Un champ fermé n'est pas enregistré : il repart à nul.
export const versEntreprise = (t: SaisieMentions['typeClient']) => t === 'assujetti' || t === 'organisme_public'
// Un client établi hors de France n'a pas de SIREN ; un particulier non plus, mais un autre non-assujetti — une
// association — peut en avoir un, et la facture le porte alors (1°).
export const sirenOuvert = (t: SaisieMentions['typeClient']) => t !== 'etranger'
export const livraisonOuverte = (n: SaisieMentions['nature']) => n === 'biens' || n === 'mixte'

const sansBlancs = (s: string) => s.replace(/\s/g, '')

// Le SIRET tel qu'il s'enregistre : sans ses espaces, que la base refuse dès qu'un SIREN l'accompagne
// (factures_emises_siret_du_siren).
export function siretAEnregistrer(siret: string): string | null {
  return sansBlancs(siret) || null
}

// Le SIREN que porte un SIRET de quatorze chiffres : un SIRET saisi sans SIREN le donne, sans attendre un clic.
export function sirenDuSiret(siret: string): string | null {
  const s = sansBlancs(siret)
  return /^\d{14}$/.test(s) ? s.slice(0, 9) : null
}

// Les contraintes de la base (migration mentions_de_la_facture), recopiées ici pour être dites avant le clic ;
// mentionsFacture.test.ts les confronte au texte de la migration.
export const FORME_SIREN = /^[0-9]{9}$/
export const FORME_SIRET = /^[0-9]{14}$/
export const FORME_ADRESSE_ELECTRONIQUE = /^[0-9]{9}(_[0-9]{14}(_[-_/@a-zA-Z0-9]{1,100})?|_[-_.@a-zA-Z0-9]{1,100})?$/
export const FORME_PAYS = /^[A-Z]{2}$/
export const LONGUEUR_CODE_SERVICE = 100
export const LONGUEUR_NUMERO_ENGAGEMENT = 50

// Ce qu'on enregistre : chaque mention, normalisée, ou nulle quand son choix ne l'ouvre pas.
export function mentionsAEnregistrer(s: SaisieMentions): Omit<MentionsFacture, 'option_debits'> {
  const entreprise = versEntreprise(s.typeClient)
  const publique = s.typeClient === 'organisme_public'
  const livraison = s.livraisonAilleurs && livraisonOuverte(s.nature)
  const texte = (v: string) => v.trim() || null
  return {
    type_client: s.typeClient || null,
    tiers_siren: sirenOuvert(s.typeClient) ? sansBlancs(s.siren) || null : null,
    tiers_adresse_electronique: entreprise ? sansBlancs(s.adresseElectronique) || null : null,
    code_service: publique ? texte(s.codeService) : null,
    numero_engagement: publique ? texte(s.numeroEngagement) : null,
    nature_operation: s.nature || null,
    date_prestation: s.prestation === 'date' ? s.datePrestation || null : null,
    periode_debut: s.prestation === 'periode' ? s.periodeDebut || null : null,
    periode_fin: s.prestation === 'periode' ? s.periodeFin || null : null,
    livraison_adresse: livraison ? texte(s.livraisonAdresse) : null,
    livraison_code_postal: livraison ? texte(s.livraisonCodePostal) : null,
    livraison_ville: livraison ? texte(s.livraisonVille) : null,
    livraison_pays: livraison ? sansBlancs(s.livraisonPays).toUpperCase() || null : null,
  }
}

// Ce que la base refuserait de la saisie, dans l'ordre du formulaire — vide quand elle l'accepte. Seulement ce qui est
// FAUX : une mention qui manque ne se refuse pas ici, puisque la base l'accepte nulle ; c'est `apercuDeTransmission` qui
// dit ce qu'il manque pour qu'elle parte par une plateforme.
export function refusDesMentions(s: SaisieMentions, siret: string): string[] {
  const m = mentionsAEnregistrer(s)
  const refus: string[] = []
  if (m.tiers_siren != null && !FORME_SIREN.test(m.tiers_siren)) refus.push('Le SIREN du client s’écrit en neuf chiffres.')
  const siretEnregistre = siretAEnregistrer(siret)
  if (m.tiers_siren != null && FORME_SIREN.test(m.tiers_siren) && siretEnregistre != null) {
    if (!FORME_SIRET.test(siretEnregistre)) refus.push('Le SIRET du client s’écrit en quatorze chiffres.')
    else if (!siretEnregistre.startsWith(m.tiers_siren)) refus.push('Le SIRET du client ne commence pas par son SIREN.')
  }
  if (m.tiers_adresse_electronique != null && !FORME_ADRESSE_ELECTRONIQUE.test(m.tiers_adresse_electronique)) {
    refus.push('L’adresse de facturation électronique s’écrit SIREN, SIREN_SIRET, SIREN_SIRET_code de routage ou SIREN_suffixe, '
      + 'sans espace ni accent.')
  }
  if (m.code_service != null && m.code_service.length > LONGUEUR_CODE_SERVICE) {
    refus.push(`Le code service tient en ${LONGUEUR_CODE_SERVICE} caractères au plus.`)
  }
  if (m.numero_engagement != null && m.numero_engagement.length > LONGUEUR_NUMERO_ENGAGEMENT) {
    refus.push(`Le numéro d’engagement tient en ${LONGUEUR_NUMERO_ENGAGEMENT} caractères au plus.`)
  }
  if (s.prestation === 'date' && m.date_prestation == null) refus.push('Indique la date de la livraison ou de la prestation.')
  if (s.prestation === 'periode') {
    if (m.periode_debut == null || m.periode_fin == null) refus.push('Indique le début et la fin de la période.')
    else if (m.periode_fin < m.periode_debut) refus.push('La période finit avant de commencer.')
  }
  if (s.livraisonAilleurs && livraisonOuverte(s.nature)) {
    if ([m.livraison_adresse, m.livraison_code_postal, m.livraison_ville, m.livraison_pays].some((v) => v == null)) {
      refus.push('L’adresse de livraison demande la voie, le code postal, la ville et le pays.')
    } else if (!FORME_PAYS.test(m.livraison_pays as string)) {
      refus.push('Le pays de livraison s’écrit en deux lettres : FR, BE, DE…')
    }
  }
  return refus
}

// ── Avant de valider : la facture pourra-t-elle partir par une plateforme agréée ? ───────────────────────────────

export interface BrouillonATransmettre {
  // L'en-tête tel que le formulaire l'enregistrerait : les parties, les dates, les montants, les mentions.
  facture: Pick<FactureEmise, 'type' | 'date_emission' | 'date_echeance' | 'tiers_nom' | 'tiers_adresse' | 'tiers_siret'
    | 'montant_ht' | 'montant_tva' | 'montant_ttc' | 'mentions_legales' | 'emetteur_nom' | 'emetteur_siret' | 'emetteur_adresse'>
    & Omit<MentionsFacture, 'option_debits'>
  // Les lignes qui partent, dans leur ordre.
  lignes: Omit<LigneCii, 'ordre'>[]
  statutTva: StatutTva | null
  articleExoneration: ArticleExoneration | null
  // L'option pour les débits que la validation figera : celle du dossier, s'il est redevable.
  optionDebits: boolean
  aujourdHui: string
}

export type ApercuTransmission =
  // Un particulier ou un client établi hors de France : la facture ne passe pas par une plateforme.
  | { cas: 'hors_plateforme'; message: string }
  | { cas: 'transmissible' }
  // Ce qui l'empêcherait de partir : `refus` à dire ici, et `ailleurs` refus que le formulaire dit déjà plus haut, avec
  // ses propres mots — ils ne se redisent pas, mais ils comptent : sans eux, la facture ne part pas non plus.
  | { cas: 'a_completer'; refus: string[]; ailleurs: number }

// Le numéro que prendra la facture n'est pas encore attribué : on juge le brouillon sous un numéro admis, puisque
// celui que la base attribue l'est toujours (F2026-0001).
const NUMERO_EN_ATTENTE = 'F0000-0000'

/**
 * Ce qui empêcherait la facture, une fois validée, de partir par une plateforme agréée : le jugement des fonctions qui
 * la transmettent (`refusEmission`), porté sur le brouillon — sans redire ce que le formulaire dit déjà de la TVA (le
 * refus d'une ligne taxée, le statut ou l'article qui manquent), qui a ses propres messages au-dessus.
 */
export function apercuDeTransmission(b: BrouillonATransmettre): ApercuTransmission {
  const f = b.facture
  if (f.type_client === 'non_assujetti' || f.type_client === 'etranger') {
    return {
      cas: 'hors_plateforme',
      message: f.type_client === 'non_assujetti'
        ? 'Une facture à un particulier ne passe pas par une plateforme agréée : l’opération se déclarera par l’e-reporting.'
        : 'Une facture à un client établi hors de France ne passe pas par une plateforme agréée : l’opération se déclarera par l’e-reporting.',
    }
  }
  const donnees = donneesDeLaFacture(
    { ...f, numero: NUMERO_EN_ATTENTE, statut: 'validee', option_debits: b.optionDebits },
    b.lignes.map((l, i) => ({ ...l, ordre: i })),
    { statut_tva: b.statutTva, article_exoneration: b.articleExoneration },
    null,
    b.aujourdHui,
  )
  const dejaDits = new Set<string>()
  const motif = motifExoneration(b.statutTva, b.articleExoneration).refus
  if (motif) dejaDits.add(motif)
  for (const l of b.lignes) {
    const r = refusTauxPositif(b.statutTva, l.taux_tva)
    if (r) dejaDits.add(r)
  }
  const tous = refusEmission(donnees)
  const refus = tous.filter((r) => !dejaDits.has(r) && !dejaDits.has(r.replace(/^Ligne \d+ : /, '')))
  return tous.length === 0 ? { cas: 'transmissible' } : { cas: 'a_completer', refus, ailleurs: tous.length - refus.length }
}
