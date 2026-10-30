import { libelleUnite, sansBlancsAuxBords } from './articles'
import { categorieJuridique } from './categoriesJuridiques'
import { pourLEspace, type EspaceVentes } from './espaceVentes'
import { mentionsImprimees, sirenDe, sirenValide, type MentionImprimee } from './factureCii'
import { formatMoney } from './format'
import type { LogoLu } from './logoDesFactures'
import {
  denominationAbsente, mentionsAFiger, refusDeLaProvenance, refusDeLaValidationFigee, refusDesTextesDeLaFacture,
  type MentionsDeLOrigine, type MentionsFigees,
} from './mentionsFigees'
import { versEntreprise } from './mentionsFacture'
import { versionCourante } from './parametresFacturation'
import { ibanParQuatre, libelleDuMoyen } from './parametresFacturationVue'
import type {
  ArticleExoneration, FactureEmise, FactureLigne, NatureArticle, ParametresFacturation, StatutTva, UniteArticle,
} from './types'

// LA FACTURE FIGE SES MENTIONS, À L'ÉCRAN (espace client, étape A7b, ligne 51.5 ; la base : A7a, lib/mentionsFigees.ts ;
// HISTORIQUE.md, « LA FACTURE FIGE SES MENTIONS, À L'ÉCRAN — ESPACE CLIENT, A7B (LIGNE 51.5) »). Un module PUR : il ne lit
// rien en base, n'appelle personne, ne lit pas l'horloge. Il dit, pour le formulaire d'une facture, la fenêtre d'un avoir et
// l'aperçu qu'on imprime :
//   - ce qu'une ligne envoie de sa provenance (l'unité, la référence, la nature, l'article d'où elle vient) ;
//   - les refus neufs d'`enregistrer_facture`, dans son ordre, sur la saisie TELLE QU'ELLE PART — ceux de lib/mentionsFigees.ts,
//     jamais une règle recopiée —, et ce qui RETIENT la validation tant qu'une lecture qui la nourrit n'est pas revenue
//     entière ;
//   - ce que la validation figera et imprimera, en mots, pour la confirmation qui le NOMME (`mentionsAFiger`) ;
//   - ce que l'aperçu d'une facture qui a figé ses mentions imprime, tiré de SES colonnes seules, jamais d'une valeur relue
//     du dossier ni recalculée le jour de l'impression (`ceQueLaFactureImprime`).
// Le mandataire ne s'imprime pas (P4) ; le CII et ses copies ne changent pas (A7c).

// ── La provenance d'une ligne ────────────────────────────────────────────────────────────────────────────────────────
/** Ce que la ligne tient de sa provenance, en texte de champ : « » pour une valeur non choisie. */
export interface ProvenanceDeLigne {
  unite: UniteArticle | ''
  reference: string
  nature: NatureArticle | ''
}

export const PROVENANCE_VIDE: ProvenanceDeLigne = { unite: '', reference: '', nature: '' }

/** Ce qu'un article apporte à la ligne qu'il remplit : son unité, sa référence et sa nature, modifiables ensuite. */
export function provenanceDeLArticle(a: { unite: UniteArticle; reference: string | null; nature: NatureArticle }): ProvenanceDeLigne {
  return { unite: a.unite, reference: a.reference ?? '', nature: a.nature }
}

/** Ce qu'une ligne lue en base porte (un brouillon rouvert, la facture qu'un avoir crédite) ; rien pour une ligne d'avant. */
export function provenanceDeLaLigneLue(l: Pick<FactureLigne, 'unite' | 'reference' | 'nature'>): ProvenanceDeLigne {
  return { unite: l.unite ?? '', reference: l.reference ?? '', nature: l.nature ?? '' }
}

/** Les quatre clés neuves qu'une ligne envoie à `enregistrer_facture` : un champ vide part nul, la référence sans les blancs de ses bords. */
export interface ProvenanceQuiPart {
  unite: UniteArticle | null
  reference: string | null
  nature: NatureArticle | null
  article_id: string | null
}

export function provenanceQuiPart(p: ProvenanceDeLigne, articleId: string | null): ProvenanceQuiPart {
  const reference = sansBlancsAuxBords(p.reference)
  return { unite: p.unite || null, reference: reference === '' ? null : reference, nature: p.nature || null, article_id: articleId }
}

// ── Ce que la validation lit ─────────────────────────────────────────────────────────────────────────────────────────
// La ligne du dossier que `enregistrer_facture` lit dans la transaction qui valide (`select d.*`), dans les colonnes que les
// refus et ce qui se fige demandent. Une seule chaîne : le client de la base type la ligne d'après elle.
export const COLONNES_DE_L_IDENTITE = 'siret, adresse, statut_tva, article_exoneration, numero_tva_attribue, denomination_imprimee, '
  + 'forme_juridique, capital, rcs_ville, mentions_identite'

// Chaque colonne LUE : une colonne absente d'une lecture n'est pas une colonne nulle, et la lecture la dit illisible.
export interface IdentiteDuDossier {
  siret: string | null
  adresse: string | null
  statut_tva: StatutTva | null
  article_exoneration: ArticleExoneration | null
  numero_tva_attribue: boolean
  denomination_imprimee: string | null
  forme_juridique: string | null
  capital: number | null
  rcs_ville: string | null
  mentions_identite: string | null
}

/** Ce que la lecture a rendu (lib/mentionsFigeesLecture.ts) : le dossier et les versions des paramètres, LUS EN ENTIER. */
export type LectureDeLaValidation =
  | { etat: 'lu'; identite: IdentiteDuDossier; versions: readonly ParametresFacturation[] }
  | { etat: 'illisible'; motif: string }

/** Ce que l'écran a lu des articles et des contacts : la liste entière, ou rien (pas encore revenue, partielle, refusée). */
export interface ListesDuDossier {
  contacts: readonly { id: string }[] | null
  articles: readonly { id: string }[] | null
}

export interface SaisieAJuger {
  espace: EspaceVentes
  dossierId: string
  // `p_facture` et `p_lignes`, tels que l'écran les enverrait.
  facture: Record<string, unknown>
  lignes: readonly Record<string, unknown>[]
  // Le brouillon que l'appel modifie, tel qu'il a été lu ; null pour une facture neuve et pour un avoir.
  brouillon: FactureEmise | null
  // Pour un avoir, la facture qu'il corrige ; null pour une facture.
  origine: FactureEmise | null
  listes: ListesDuDossier
  // Null tant que la lecture n'est pas revenue.
  lecture: LectureDeLaValidation | null
}

export interface JugementDesMentions {
  // Ce qui refuse l'enregistrement, brouillon compris : la provenance, puis un IBAN dans un texte.
  refusDeLEnregistrement: string | null
  // Ce qui RETIENT la validation : une lecture qui la nourrit n'est pas revenue entière. La validation n'est pas offerte.
  retenue: string | null
  // Le premier refus neuf de la validation (lib/mentionsFigees.ts, `refusDeLaValidationFigee`).
  refusDeLaValidation: string | null
  // Ce que la validation figerait ; null tant qu'on ne le sait pas.
  mentions: MentionsFigees | null
  // Ce que le cabinet valide encore, et qu'on lui dit : une identité sans forme, une facture sans dénomination.
  avis: string[]
}

export const RETENUE_EN_LECTURE = 'Ce que la validation figera (l’identité du dossier, ses paramètres de facturation) est en cours de '
  + 'lecture : la validation attend la réponse.'

export function retenueIllisible(motif: string): string {
  return `Ce que la validation figera n’a pas pu être lu entier (${motif}) : la validation n’est pas offerte, le brouillon s’enregistre. `
    + 'Rouvre la facture pour relire.'
}

export const RETENUE_CHAINE_ROMPUE = 'Les versions des paramètres de facturation lues ne forment pas une suite : on ne sait pas laquelle '
  + 'la facture figerait, et la validation n’est pas offerte.'

const RETENUE_LISTES = 'La provenance de la facture (le client ou un article d’où elle vient) ne se juge que sur la liste entière des '
  + 'clients et des articles, qui n’est pas lue : rien ne s’enregistre d’ici. Rouvre la facture pour les relire.'

const ids = (l: readonly { id: string }[]) => l.map((x) => x.id)
const valeurNonNulle = (v: unknown) => v !== undefined && v !== null

/**
 * Le jugement de la saisie : les refus neufs d'`enregistrer_facture` dans son ordre (la provenance, un IBAN dans un texte ;
 * puis, à la validation, les refus de la validation figée), ce qui retient la validation, ce qu'elle figerait. Les refus
 * d'hier (le nom du client, les lignes, la TVA, les mentions de la facture électronique) passent avant, et ceux de la
 * source de la vente après, chez l'appelant.
 */
export function jugementDesMentions(s: SaisieAJuger): JugementDesMentions {
  const avoir = s.origine !== null
  const jugement: JugementDesMentions = { refusDeLEnregistrement: null, retenue: null, refusDeLaValidation: null, mentions: null, avis: [] }
  const dire = (t: string) => pourLEspace(s.espace, t)

  // La provenance ne se juge que sur des listes ENTIÈRES ; une saisie qui ne nomme ni contact ni article n'en demande aucune.
  const nommeUnContact = !avoir && valeurNonNulle(s.facture.contact_id)
  const nommeUnArticle = s.lignes.some((l) => valeurNonNulle(l.article_id))
  if ((nommeUnContact && s.listes.contacts === null) || (nommeUnArticle && s.listes.articles === null)) {
    jugement.refusDeLEnregistrement = dire(RETENUE_LISTES)
    jugement.retenue = jugement.refusDeLEnregistrement
    return jugement
  }
  const provenance = refusDeLaProvenance({
    avoir, facture: s.facture, lignes: s.lignes,
    contactsDuDossier: ids(s.listes.contacts ?? []), articlesDuDossier: ids(s.listes.articles ?? []),
  })
  const textes = provenance ?? refusDesTextesDeLaFacture({ avoir, facture: s.facture, lignes: s.lignes, brouillon: s.brouillon })
  if (textes) {
    jugement.refusDeLEnregistrement = dire(textes.message)
    return jugement
  }

  // La validation : ce qu'elle lit doit être revenu, entier.
  if (s.lecture === null) { jugement.retenue = dire(RETENUE_EN_LECTURE); return jugement }
  if (s.lecture.etat === 'illisible') { jugement.retenue = dire(retenueIllisible(s.lecture.motif)); return jugement }
  const { identite, versions } = s.lecture
  const courante = versionCourante(versions, s.dossierId)
  const origine: MentionsDeLOrigine | null = s.origine
  const mentions = mentionsAFiger({
    dossierId: s.dossierId,
    // Le SIRET que la facture portera : celui de la saisie ; pour un avoir, celui de sa facture, qu'il recopie.
    emetteurSiret: avoir ? s.origine?.emetteur_siret ?? null : texteOuNul(s.facture.emetteur_siret),
    origine,
    dossier: identite,
    versions,
    // Le mandataire ne s'imprime pas avant P4 : l'écran n'en dit rien, la base le pose.
    mandataire: null,
  })
  if (courante === 'rompue' || mentions === 'rompue') { jugement.retenue = dire(RETENUE_CHAINE_ROMPUE); return jugement }

  const reprise = origine !== null && origine.mentions_figees === true
  // Le contact que la facture garde : la saisie le nomme toujours (une clé posée, nulle ou non) ; un avoir prend celui de sa facture.
  const contactGarde = avoir ? s.origine?.contact_id ?? null : texteOuNul(s.facture.contact_id)
  if (contactGarde !== null && s.listes.contacts === null) {
    jugement.retenue = dire(RETENUE_LISTES)
    return jugement
  }
  const refus = refusDeLaValidationFigee({
    contactGarde,
    contactsDuDossier: ids(s.listes.contacts ?? []),
    formeJuridique: mentions.forme_juridique,
    denomination: mentions.denomination_imprimee,
    rcsVille: mentions.rcs_ville,
    mentionsIdentite: mentions.mentions_identite,
    cabinet: s.espace === 'cabinet',
    avoir,
    reprise,
    emetteurSiret: texteOuNul(s.facture.emetteur_siret),
    emetteurAdresse: texteOuNul(s.facture.emetteur_adresse),
    dossierSiret: identite.siret,
    dossierAdresse: identite.adresse,
    parametres: courante,
  })
  jugement.mentions = mentions
  if (refus) {
    jugement.refusDeLaValidation = dire(refus.message)
    return jugement
  }
  // Ce que le cabinet valide encore, et qu'il ne validerait pas depuis l'espace du client (A7-Q1, A7Q-Q1) : dit avant le clic.
  if (s.espace === 'cabinet' && !reprise) {
    if (mentions.forme_juridique === null) jugement.avis.push(AVIS_SANS_FORME)
    if (denominationAbsente(mentions.denomination_imprimee)) jugement.avis.push(avisSansDenomination(nomDeRepli(s)))
  }
  return jugement
}

const texteOuNul = (v: unknown): string | null => (typeof v === 'string' ? v : null)

// Le nom que la facture imprime faute de dénomination : celui qu'elle porte (`emetteur_nom`), pour un avoir celui de sa facture.
function nomDeRepli(s: SaisieAJuger): string | null {
  return s.origine !== null ? s.origine.emetteur_nom : texteOuNul(s.facture.emetteur_nom)
}

export const AVIS_SANS_FORME = 'La forme juridique du dossier n’est pas renseignée (onglet Informations, « Identité du dossier ») : la '
  + 'facture figera une identité sans forme. Le cabinet la valide encore ; un accès « Ventes » ne la validerait pas.'

export function avisSansDenomination(nom: string | null): string {
  return 'La dénomination du dossier n’est pas renseignée (onglet Informations, « Identité du dossier ») : la facture imprimera '
    + (nom ? `le nom « ${nom} » qu’elle porte.` : 'le nom qu’elle porte.')
    + ' Le cabinet la valide encore ; un accès « Ventes » ne la validerait pas.'
}

// ── La confirmation : ce que la facture figera et imprimera ─────────────────────────────────────────────────────────
export const AUCUN_RIB_CONFIRME = 'aucun RIB confirmé : la facture n’en imprimera pas'

/**
 * Ce que la validation figera et imprimera, une phrase par mention, dans l'ordre du papier : le nom légal (avec « EI »),
 * l'identité, le numéro de TVA, les conditions de paiement, le RIB CONFIRMÉ (ou qu'il n'y en a pas), le logo. `nom` : celui
 * que la facture imprime faute de dénomination.
 */
export function ceQueLaValidationFigera(m: MentionsFigees, nom: string | null): string[] {
  const phrases: string[] = []
  phrases.push(m.denomination_imprimee != null && !denominationAbsente(m.denomination_imprimee)
    ? `le nom « ${m.denomination_imprimee} »`
    : `aucune dénomination : le nom « ${nom ?? ''} » que la facture porte`)
  const identite = [formeEtCapital(m.forme_juridique, m.capital), m.rcs_ville ? `RCS ${m.rcs_ville}` : null, m.mentions_identite]
    .filter((x): x is string => x != null && x !== '')
  if (identite.length > 0) phrases.push(`l’identité : ${identite.join(' ; ').replace(/\s*\n\s*/g, ' ')}`)
  phrases.push(m.numero_tva_imprime ? `le numéro de TVA ${m.numero_tva_imprime}` : 'aucun numéro de TVA')
  if (m.parametres_id === null) {
    phrases.push('aucun paramètre de facturation : ni conditions de paiement, ni RIB, ni logo')
    return phrases
  }
  const conditions = [
    m.moyen_prefere ? `moyen préféré : ${libelleDuMoyen(m.moyen_prefere).toLowerCase()}` : null,
    m.escompte ? `escompte : « ${m.escompte} »` : null,
    m.penalites ? `pénalités : « ${m.penalites} »` : null,
  ].filter((x): x is string => x !== null)
  phrases.push(conditions.length > 0 ? `les conditions de paiement (${conditions.join(' ; ')})` : 'aucune condition de paiement')
  phrases.push(m.iban_imprime
    ? `le RIB ${ibanParQuatre(m.iban_imprime)}${m.bic_imprime ? `, BIC ${m.bic_imprime}` : ''}${m.titulaire_imprime ? `, au nom de ${m.titulaire_imprime}` : ''}`
    : AUCUN_RIB_CONFIRME)
  if (m.mentions_complementaires) phrases.push('les mentions complémentaires des paramètres')
  if (m.pied_de_page) phrases.push('le pied de page des paramètres')
  phrases.push(m.logo_chemin ? 'le logo des paramètres' : 'aucun logo')
  return phrases
}

/** La confirmation entière : l'en-tête, puis une mention par ligne. */
export function confirmationDesMentions(m: MentionsFigees, nom: string | null, avoir: boolean): string {
  const quoi = avoir ? 'Validé, l’avoir figera et imprimera' : 'Validée, la facture figera et imprimera'
  return `${quoi} :\n${ceQueLaValidationFigera(m, nom).map((p) => `– ${p}`).join('\n')}`
}

// ── Ce que l'aperçu imprime d'une facture qui a figé ses mentions ────────────────────────────────────────────────────
/** La forme juridique sous son libellé de l'INSEE, son capital à sa suite ; null sans forme ni capital. */
export function formeEtCapital(forme: string | null, capital: number | null): string | null {
  const libelle = forme === null ? null : categorieJuridique(forme)?.libelle ?? forme
  const auCapital = capital === null ? null : `au capital de ${formatMoney(capital)}`
  if (libelle && auCapital) return `${libelle} ${auCapital}`
  return libelle ?? (auCapital ? `Société ${auCapital}` : null)
}

// L'indemnité forfaitaire pour frais de recouvrement : un montant que la loi fixe (C. com., art. D441-5), qu'aucun paramètre ne
// porte ; elle se compose du type de client figé, comme l'escompte et les pénalités (C. com., art. L441-9, I : entre
// professionnels). Une facture à un particulier ne les porte pas.
export const INDEMNITE_DE_RECOUVREMENT = 'Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 € '
  + '(C. com., art. D441-5).'

export interface ImpressionFigee {
  // Le nom légal : la dénomination figée, sinon le nom que la facture porte.
  nom: string | null
  // L'identité, une ligne chacune : la forme et le capital, le RCS et sa ville, les autres mentions.
  identite: string[]
  numeroTva: string | null
  // Les conditions de paiement, dans l'ordre du papier.
  conditions: string[]
  rib: { iban: string; bic: string | null; titulaire: string | null } | null
  complementaires: string | null
  piedDePage: string | null
  logo: { chemin: string; empreinte: string } | null
  // Les mentions de la facture électronique, le numéro d'engagement compris pour tout acheteur.
  mentions: MentionImprimee[]
}

const SIREN_LISIBLE = (siren: string) => siren.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')

/**
 * Ce qu'une facture qui a FIGÉ ses mentions imprime, de ses seules colonnes : rien n'est relu du dossier, rien n'est
 * recalculé (le numéro de TVA est celui que la base a écrit). Null pour une facture d'avant (`mentions_figees` faux ou
 * absent) : elle s'imprime comme hier.
 */
export function ceQueLaFactureImprime(f: FactureEmise): ImpressionFigee | null {
  if (f.mentions_figees !== true) return null
  const siren = sirenDe(f.emetteur_siret)
  const rcs = f.rcs_ville ? `RCS ${f.rcs_ville}${sirenValide(siren) ? ` ${SIREN_LISIBLE(siren)}` : ''}` : null
  const identite = [formeEtCapital(f.forme_juridique ?? null, f.capital ?? null), rcs, f.mentions_identite ?? null]
    .filter((x): x is string => x != null && x !== '')
  const professionnel = versEntreprise(f.type_client ?? '')
  const conditions = [
    f.moyen_prefere ? `Moyen de paiement préféré : ${libelleDuMoyen(f.moyen_prefere).toLowerCase()}.` : null,
    professionnel ? f.escompte ?? null : null,
    professionnel ? f.penalites ?? null : null,
    professionnel ? INDEMNITE_DE_RECOUVREMENT : null,
  ].filter((x): x is string => x != null && x !== '')
  const mentions = mentionsImprimees(f)
  // Le numéro d'engagement (BT-13 ; C. com., art. L441-9, I : le bon de commande de l'acheteur) s'imprime pour tout acheteur
  // depuis A7a ; `mentionsImprimees` ne le dit que d'un organisme public, avec le code service, qui lui reste réservé.
  if (f.type_client !== 'organisme_public' && f.numero_engagement) {
    mentions.push({ libelle: 'Numéro d’engagement', texte: f.numero_engagement })
  }
  return {
    nom: f.denomination_imprimee != null && !denominationAbsente(f.denomination_imprimee) ? f.denomination_imprimee : f.emetteur_nom,
    identite,
    numeroTva: f.numero_tva_imprime ?? null,
    conditions,
    rib: f.iban_imprime ? { iban: ibanParQuatre(f.iban_imprime), bic: f.bic_imprime ?? null, titulaire: f.titulaire_imprime ?? null } : null,
    complementaires: f.mentions_complementaires ?? null,
    piedDePage: f.pied_de_page ?? null,
    logo: f.logo_chemin && f.logo_sha256 ? { chemin: f.logo_chemin, empreinte: f.logo_sha256 } : null,
    mentions,
  }
}

/** L'unité d'une ligne, sous son libellé ; vide pour une ligne qui n'en porte pas. */
export function uniteImprimee(l: Pick<FactureLigne, 'unite'>): string {
  return l.unite ? libelleUnite(l.unite) : ''
}

/** Ce que l'écran (jamais le papier) dit d'une facture validée avant que les factures figent leurs mentions. */
export const FACTURE_D_AVANT = 'Cette facture a été validée avant que les factures figent leurs mentions : elle s’imprime comme '
  + 'elle s’est toujours imprimée, et son numéro de TVA se calcule du statut de TVA d’aujourd’hui.'

// ── Le logo figé ─────────────────────────────────────────────────────────────────────────────────────────────────────
// L'aperçu ne montre le logo qu'APRÈS avoir recalculé l'empreinte du fichier rendu et l'avoir trouvée égale à celle que la
// facture a figée (lib/logoDesFacturesLecture.ts) : un fichier qui ne la rend pas ne s'affiche pas — ni à l'écran, ni sur le
// papier —, et l'écran (jamais le papier) dit pourquoi.
export const LOGO_EN_LECTURE = 'Le logo que la facture a figé est en cours de lecture : il s’imprimera une fois son empreinte vérifiée.'

/** Pourquoi le logo figé ne s'imprime pas ; null quand son fichier est vérifié. */
export function logoNonImprime(lu: LogoLu): string | null {
  switch (lu.etat) {
    case 'verifie':
      return null
    case 'absent':
      return 'Le fichier du logo que la facture a figé n’est pas (ou plus) rendu par le stockage : il ne s’imprime pas.'
    case 'refuse':
      return `Le stockage n’a pas rendu le fichier du logo que la facture a figé (${lu.motif}) : il ne s’imprime pas.`
    case 'illisible':
      return 'Le fichier du logo a été rendu, mais il n’a pas pu être lu comme une image PNG ou JPEG : il ne s’imprime pas.'
    case 'autre_empreinte':
      return 'Le fichier rendu n’est pas le logo que la facture a figé (son empreinte diffère) : il ne s’imprime pas.'
  }
}
