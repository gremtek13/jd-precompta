// LE STATUT DE TVA D'UN DOSSIER, ET CE QU'IL DÉCIDE (ligne 28.5 de la feuille de route, étape a ; décision du
// cabinet du 07/10/2026) : redevable, franchise en base, exonéré — ou à préciser, tant que personne ne l'a dit.
//
// Le dossier ne connaissait qu'un booléen, `assujetti_tva`, qui rangeait sous « non » deux situations que la
// facturation électronique sépare. LA FRANCHISE EN BASE (CGI, art. 293 B) N'EST PAS UNE EXONÉRATION : un
// franchisé est dans le champ de l'émission et de l'e-reporting, et sa facture porte « TVA non applicable,
// art. 293 B du CGI ». UNE EXONÉRATION (art. 261 à 261 E — les soins de l'art. 261, 4, 1° au premier rang) en
// sort, et sa facture cite l'article qui exonère. L'application proposait la mention de la franchise sur la
// facture d'un dossier de soins exonérés, et superpdp-emit la transmettait comme motif de toute ligne à 0 %.
//
// En base, `statut_tva` FAIT FOI et `assujetti_tva` en est déduit (migration `statut_tva_du_dossier`) : il reste
// lu partout où l'on demande si le dossier récupère la TVA. Ce module dit le reste — la mention d'une facture, le
// motif d'une ligne à 0 % qu'on transmet à une plateforme, et ce que le dossier doit à la facturation
// électronique —, sans jamais deviner un statut qu'on ne connaît pas : à préciser, il se dit à préciser.

import { libelleFrequence, obligationsEreporting, type EtatObligation, type ObjetEreporting } from './periodesEreporting'
import type { ArticleExoneration, PeriodiciteTva, StatutTva } from './types'

export interface StatutTvaPropose {
  statut: StatutTva
  libelle: string
  // Ce que le statut veut dire, en une phrase, pour qui le choisit.
  explication: string
}

// Dans l'ordre où l'écran les propose.
export const STATUTS_TVA: readonly StatutTvaPropose[] = [
  {
    statut: 'redevable',
    libelle: 'Redevable de la TVA',
    explication: 'Il facture la TVA, la déclare, et récupère celle qu’il paie.',
  },
  {
    statut: 'franchise',
    libelle: 'Franchise en base (art. 293 B du CGI)',
    explication: 'Il ne facture pas de TVA tant qu’il reste sous les seuils de la franchise, et ne récupère pas celle qu’il paie.',
  },
  {
    statut: 'exonere',
    libelle: 'Exonéré (art. 261 à 261 E du CGI)',
    explication: 'Son activité est exonérée — des soins, un enseignement, de l’assurance — et il ne récupère pas la TVA qu’il paie.',
  },
]

// Pour un badge : « TVA : redevable », « TVA : à préciser ».
export function libelleCourtStatutTva(statut: StatutTva | null): string {
  switch (statut) {
    case 'redevable': return 'redevable'
    case 'franchise': return 'franchise en base'
    case 'exonere': return 'exonéré'
    case null: return 'à préciser'
  }
}

// ── DÉBUT COPIE statutTva ────────────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans les Edge Functions qui transmettent une facture (superpdp-emit,
// plateforme-agreee) : le générateur de la facture électronique, qu'elles recopient aussi, en tire le motif d'une
// ligne à 0 % et le refus d'une ligne taxée. `copiesFacturation.test.ts` compare chaque copie à celui-ci et l'exécute.

export interface Exoneration {
  code: ArticleExoneration
  // Ce que l'article exonère, pour la liste de choix.
  objet: string
  // La disposition, telle qu'une facture la cite.
  reference: string
  // La mention de la facture : la référence de la disposition qui exonère (CGI, ann. II, art. 242 nonies A).
  mention: string
  // Le code du motif d'exonération (BT-121 de la norme EN 16931), dans la liste VATEX que la France a complétée. La
  // facture électronique (factureCii.ts) transmet le code ET le texte, et le validateur officiel de la norme les accepte.
  vatex: string
}

// La liste fermée de la base (`dossiers_article_exoneration_check`) : `statutTva.test.ts` la confronte à la
// migration exportée. Un article qui n'y est pas se saisit à la main sur la facture.
export const EXONERATIONS: readonly Exoneration[] = [
  {
    code: 'cgi_261_4_1',
    objet: 'Soins dispensés par les professions médicales et paramédicales',
    reference: 'art. 261, 4, 1° du CGI',
    mention: 'Exonération de TVA, art. 261, 4, 1° du CGI.',
    vatex: 'VATEX-FR-CGI261-4',
  },
  {
    code: 'cgi_261_4_4_a',
    objet: 'Enseignement scolaire ou universitaire, formation professionnelle continue',
    reference: 'art. 261, 4, 4° a du CGI',
    mention: 'Exonération de TVA, art. 261, 4, 4° a du CGI.',
    vatex: 'VATEX-FR-CGI261-4',
  },
  {
    code: 'cgi_261_4_4_b',
    objet: 'Cours particuliers donnés par une personne physique à ses élèves',
    reference: 'art. 261, 4, 4° b du CGI',
    mention: 'Exonération de TVA, art. 261, 4, 4° b du CGI.',
    vatex: 'VATEX-FR-CGI261-4',
  },
  {
    code: 'cgi_261_c_2',
    objet: 'Assurance et réassurance, courtage et intermédiation en assurance',
    reference: 'art. 261 C, 2° du CGI',
    mention: 'Exonération de TVA, art. 261 C, 2° du CGI.',
    vatex: 'VATEX-FR-CGI261C-2',
  },
]

export function exonerationDe(article: ArticleExoneration | null): Exoneration | null {
  return article == null ? null : EXONERATIONS.find((e) => e.code === article) ?? null
}

export const MENTION_FRANCHISE = 'TVA non applicable, art. 293 B du CGI.'
export const VATEX_FRANCHISE = 'VATEX-FR-FRANCHISE'

export interface MotifExoneration {
  // La catégorie de TVA de la ligne (BT-151) : E, exonérée — la franchise en base comprise, dans la norme.
  categorie: 'E'
  code: string
  texte: string
}

// Le motif d'une ligne à 0 % qu'on transmet à une plateforme (BT-120, BT-121), ou la raison de ne pas la
// transmettre : un motif faux part dans une facture que l'administration reçoit, et ne se reprend que par un avoir.
export function motifExoneration(
  statut: StatutTva | null, article: ArticleExoneration | null,
): { motif: MotifExoneration; refus: null } | { motif: null; refus: string } {
  if (statut == null) {
    return { motif: null, refus: 'Le statut de TVA du dossier est à préciser : choisis-le dans l’onglet TVA du dossier avant de transmettre une facture.' }
  }
  if (statut === 'franchise') {
    return { motif: { categorie: 'E', code: VATEX_FRANCHISE, texte: MENTION_FRANCHISE }, refus: null }
  }
  const exoneration = exonerationDe(article)
  if (exoneration) {
    return { motif: { categorie: 'E', code: exoneration.vatex, texte: exoneration.mention }, refus: null }
  }
  return {
    motif: null,
    refus: statut === 'exonere'
      ? 'Le dossier est exonéré sans article d’exonération : choisis-le dans l’onglet TVA du dossier avant de transmettre une facture à 0 %.'
      : 'Une ligne à 0 % d’un dossier redevable demande l’article de son exonération : choisis-le dans l’onglet TVA du dossier, ou corrige le taux.',
  }
}

// Une ligne qui porte de la TVA sur la facture d'un dossier qui n'en facture pas. Toute personne qui mentionne la
// TVA sur une facture en devient redevable du seul fait de l'avoir facturée (CGI, art. 283, 3) : c'est une
// facture à corriger par un avoir, pas à transmettre.
export function refusTauxPositif(statut: StatutTva | null, taux: number): string | null {
  if (taux <= 0) return null
  const tauxLu = `${String(taux).replace('.', ',')}\u00a0%`
  if (statut === 'franchise') {
    return `Un dossier en franchise en base ne facture pas de TVA : une ligne à ${tauxLu} la rendrait due (art. 283, 3 du CGI). `
      + 'S’il a dépassé les seuils de la franchise, il est redevable : change son statut de TVA.'
  }
  if (statut === 'exonere') {
    return `Un dossier exonéré ne facture pas de TVA : une ligne à ${tauxLu} la rendrait due (art. 283, 3 du CGI). `
      + 'Si une partie de son activité est taxable, il est redevable, avec l’article de son exonération.'
  }
  return null
}
// ── FIN COPIE statutTva ──────────────────────────────────────────────────────────────────────────────────────────────

// Ce qu'on écrit en base pour un statut choisi. Un article n'a de sens que pour un dossier exonéré, ou redevable
// d'une activité en partie exonérée : passer en franchise le RETIRE, dans la même écriture. La base refuse un
// article sur une franchise plutôt que de l'effacer en silence (`dossiers_article_exoneration_coherent`), donc
// c'est à l'écran de l'envoyer nul. De même la case du numéro de TVA, qui n'a de sens qu'en franchise ou exonéré
// (`dossiers_numero_tva_attribue_coherent`) : un redevable en a toujours un.
export function ecritureDuStatut(
  statut: StatutTva, article: ArticleExoneration | null, numeroAttribue: boolean,
): { statut_tva: StatutTva; article_exoneration: ArticleExoneration | null; numero_tva_attribue: boolean } {
  return {
    statut_tva: statut,
    article_exoneration: statut === 'franchise' ? null : article,
    numero_tva_attribue: (statut === 'franchise' || statut === 'exonere') && numeroAttribue,
  }
}

// La case du numéro de TVA ne se pose qu'à un dossier en franchise ou exonéré.
export const numeroTvaACocher = (statut: StatutTva | null) => statut === 'franchise' || statut === 'exonere'

// La mention de TVA d'une facture du dossier, proposée à sa création. Aucune pour un redevable, qui facture la
// TVA — une ligne à 0 % d'un redevable dont une partie de l'activité est exonérée prend la mention de son
// article, que `motifExoneration` donne. Aucune non plus quand on ne sait pas laquelle : `manqueMentionTva` le dit.
export function mentionTva(statut: StatutTva | null, article: ArticleExoneration | null): string | null {
  if (statut === 'franchise') return MENTION_FRANCHISE
  if (statut === 'exonere') return exonerationDe(article)?.mention ?? null
  return null
}

// Ce qui empêche de proposer la bonne mention, dit à qui rédige la facture.
export function manqueMentionTva(statut: StatutTva | null, article: ArticleExoneration | null): string | null {
  if (statut == null) {
    return 'Le statut de TVA du dossier est à préciser (onglet TVA du dossier) : la mention de TVA de la facture en dépend.'
  }
  if (statut === 'exonere' && exonerationDe(article) == null) {
    return 'Le dossier est exonéré sans article d’exonération : saisis la mention de la facture, ou choisis l’article dans l’onglet TVA du dossier.'
  }
  return null
}

// ── Ce que le dossier doit à la facturation électronique ──────────────────────────────────────────────────────
//
// Tout assujetti — même exonéré, même en franchise — doit pouvoir RECEVOIR ses factures sous forme électronique
// depuis le 1er septembre 2026. L'ÉMISSION et l'e-reporting de ses VENTES ne visent que les opérations imposables,
// dans le champ et NON EXONÉRÉES : un franchisé y est tenu ; un dossier exonéré ne l'est pas pour ses opérations
// exonérées, mais l'est pour les autres s'il en a — la redevance que lui verse un collaborateur appelle une facture
// électronique (FAQ « J'approfondis » d'impots.gouv.fr, §2.10). Et TOUT assujetti établi en France, exonéré compris,
// déclare par l'e-reporting ses ACHATS à un fournisseur établi hors de France : un abonnement à un logiciel facturé
// de l'étranger suffit. L'application disait d'un dossier exonéré qu'il « n'y est pas tenu » et ne devait que la
// réception — faux pour ses achats, et pour ses opérations taxables. Pour une PME ou une micro-entreprise, l'émission
// et l'e-reporting commencent au 1er septembre 2027 (le 1er septembre 2026 pour une ETI ou une grande entreprise, que
// l'application ne distingue pas : ses dossiers sont des cabinets et des praticiens). Les données de paiement — le
// statut « Encaissée » et l'e-reporting des paiements — ne concernent que les prestations dont la TVA est due à
// l'encaissement : pas sur option pour les débits.
//
// Qui est tenu à l'e-reporting et de quoi, depuis quand et à quelle fréquence vit dans lib/periodesEreporting.ts,
// avec ses sources ; ce module en écrit les phrases, sans rien décider d'autre que l'émission et la réception.

export const DEBUT_RECEPTION = '2026-09-01'
export const DEBUT_EMISSION_PME = '2027-09-01'

export type { EtatObligation }

export interface ObligationFacturationElectronique {
  cle: 'reception' | 'emission' | 'transactions' | 'achats' | 'paiements'
  libelle: string
  etat: EtatObligation
  // La date à partir de laquelle elle est due ; nulle quand elle ne l'est pas, ou qu'on ne le sait pas.
  depuis: string | null
  detail: string
}

const A_PRECISER = 'Dépend du statut de TVA du dossier, à préciser dans l’onglet TVA.'
const CALENDRIER = 'À partir du 1er septembre 2027 pour une PME ou une micro-entreprise (1er septembre 2026 pour une ETI ou une grande entreprise).'
const EMISSION = 'Émettre ses factures électroniques'
const VENTES = 'Transmettre ses autres ventes (e-reporting)'
const ACHATS = 'Transmettre ses achats à l’étranger (e-reporting)'
const PAIEMENTS = 'Transmettre ses encaissements'
// Les exemples sont des SERVICES : c'est l'achat à l'étranger le plus courant d'un cabinet ou d'un praticien, et celui
// dont il doit lui-même la TVA (autoliquidation).
const SES_ACHATS = 'ses achats à un fournisseur établi hors de France — un logiciel en ligne, une formation, de la publicité —'
// Un franchisé ou un exonéré n'a de numéro de TVA que s'il le demande, et un tel achat le lui fait demander
// (BOI-TVA-DECLA-20-10-20, §20 et §40) ; un redevable en a toujours un.
const NUMERO_REQUIS = 'Il lui faut alors un numéro de TVA intracommunautaire.'
const majuscule = (texte: string) => texte.charAt(0).toUpperCase() + texte.slice(1)

export function obligationsFacturationElectronique(
  statut: StatutTva | null, article: ArticleExoneration | null, periodicite: PeriodiciteTva, surDebits: boolean,
): ObligationFacturationElectronique[] {
  const exoneration = exonerationDe(article)
  // Redevable d'une activité en partie exonérée : tenu pour ses opérations taxables, pas pour les autres.
  const enPartie = statut === 'redevable' && exoneration != null
  const horsChamp = exoneration
    ? `Ses opérations exonérées (${exoneration.reference}) en sortent.`
    : 'Ses opérations exonérées en sortent.'
  const pourSesOperationsTaxables = enPartie ? `Pour ses opérations taxables. ${horsChamp} ` : ''
  const ereporting = obligationsEreporting(statut, article, periodicite, surDebits)
  const rythme = (objet: ObjetEreporting, avecLaRaison: boolean) => {
    const frequence = ereporting[objet].frequence
    return frequence == null ? '' : libelleFrequence(frequence, avecLaRaison)
  }
  // L'état et la date d'une ligne d'e-reporting sont ceux du module : seule la phrase s'écrit ici.
  const ligne = (
    cle: ObligationFacturationElectronique['cle'], libelle: string, objet: ObjetEreporting, detail: string,
  ): ObligationFacturationElectronique => ({ cle, libelle, etat: ereporting[objet].etat, depuis: ereporting[objet].depuis, detail })

  const reception: ObligationFacturationElectronique = {
    cle: 'reception',
    libelle: 'Recevoir ses factures d’achat électroniques',
    etat: 'due',
    depuis: DEBUT_RECEPTION,
    detail: 'Depuis le 1er septembre 2026, par la plateforme agréée qu’il a choisie. Tout assujetti y est tenu, même exonéré ou en franchise.',
  }

  if (statut == null) {
    return [
      reception,
      { cle: 'emission', libelle: EMISSION, etat: 'a_preciser', depuis: null, detail: A_PRECISER },
      ligne('transactions', VENTES, 'ventes', A_PRECISER),
      ligne('achats', ACHATS, 'achats',
        `${majuscule(SES_ACHATS)}, quel que soit son statut de TVA ; leur fréquence en dépend, à préciser dans l’onglet TVA. ${CALENDRIER}`),
      ligne('paiements', PAIEMENTS, 'paiements', A_PRECISER),
    ]
  }

  if (statut === 'exonere') {
    // L'exemple de la FAQ ne vaut que pour une profession de santé : la collaboration libérale d'un praticien.
    const exemple = article === 'cgi_261_4_1' ? ' — la redevance que lui verse un collaborateur, par exemple —' : ''
    return [
      reception,
      {
        cle: 'emission', libelle: EMISSION, etat: 'le_cas_echeant', depuis: DEBUT_EMISSION_PME,
        detail: `${horsChamp} S’il a aussi des opérations taxables${exemple}, ses factures à des professionnels établis en France `
          + `s’émettent sous forme électronique. ${CALENDRIER}`,
      },
      ligne('transactions', VENTES, 'ventes', `${horsChamp} S’il a aussi des opérations taxables à des particuliers ou à des `
        + `clients établis hors de France, elles s’y déclarent, ${rythme('ventes', false)}. ${CALENDRIER}`),
      ligne('achats', ACHATS, 'achats', `Même exonéré, il y est tenu : ${SES_ACHATS}, ${rythme('achats', true)}. `
        + `${NUMERO_REQUIS} ${CALENDRIER}`),
      ligne('paiements', PAIEMENTS, 'paiements', `${horsChamp} S’il a aussi des prestations de services taxables : le statut `
        + `« Encaissée » de ses factures et l’e-reporting de ses paiements, ${rythme('paiements', false)}. ${CALENDRIER}`),
    ]
  }

  const numero = statut === 'franchise' ? ` ${NUMERO_REQUIS}` : ''
  return [
    reception,
    {
      cle: 'emission', libelle: EMISSION, etat: enPartie ? 'en_partie' : 'due', depuis: DEBUT_EMISSION_PME,
      detail: `${pourSesOperationsTaxables}Ses factures à des professionnels établis en France. ${CALENDRIER}`,
    },
    ligne('transactions', VENTES, 'ventes', `${pourSesOperationsTaxables}Ses ventes à des particuliers et à des clients établis `
      + `hors de France, ${rythme('ventes', false)}. ${CALENDRIER}`),
    ligne('achats', ACHATS, 'achats', `${majuscule(SES_ACHATS)}, ${rythme('achats', false)}.${numero} ${CALENDRIER}`),
    ligne('paiements', PAIEMENTS, 'paiements', ereporting.paiements.etat === 'non_due'
      ? 'Sur option pour les débits, la TVA de ses prestations est due à la facture : il n’a pas de données de paiement à transmettre.'
      : `${pourSesOperationsTaxables}Le statut « Encaissée » de ses factures et l’e-reporting de ses paiements, pour ses `
        + `prestations de services, ${rythme('paiements', false)}. ${CALENDRIER}`),
  ]
}

// La même chose en une phrase, pour un en-tête ou une infobulle.
export function resumeObligations(statut: StatutTva | null, article: ArticleExoneration | null): string {
  if (statut == null) {
    return 'Réception des factures électroniques depuis le 1er septembre 2026 ; e-reporting de ses achats à l’étranger au '
      + '1er septembre 2027 ; le reste dépend du statut de TVA, à préciser.'
  }
  if (statut === 'exonere') {
    return 'Réception des factures électroniques depuis le 1er septembre 2026 ; au 1er septembre 2027, e-reporting de ses '
      + 'achats à l’étranger, et émission et e-reporting de ses opérations taxables s’il en a : ses opérations exonérées en sortent.'
  }
  // L'émission ne vise que ses opérations taxables ; l'e-reporting de ses achats à l'étranger, tous ses achats.
  const enPartie = statut === 'redevable' && exonerationDe(article) != null
    ? ', pour ses opérations taxables, et e-reporting de ses achats à l’étranger'
    : ''
  return `Réception des factures électroniques depuis le 1er septembre 2026 ; émission et e-reporting au 1er septembre 2027${enPartie}.`
}

// ── Ce que l'onglet TVA dit d'un dossier dont il ne prépare pas la déclaration ─────────────────────────────────────
//
// Un dossier en franchise ou exonéré ne facture pas de TVA et n'en déclare pas sur ses ventes. Mais un assujetti,
// franchisé ou exonéré compris, qui achète un service à un prestataire établi hors de France en est « redevable de la
// taxe en France en application du 2° de l'article 283 du CGI », et un numéro de TVA lui est attribué pour cela, sur
// demande à son service des impôts (BOI-TVA-DECLA-20-10-20, §40 ; la TVA passe au CIBS le 01/01/2027, article
// correspondant non relu). L'onglet disait « il n'a pas de déclaration à déposer », sans réserve. Et la CA3 de
// l'application ne prépare pas l'autoliquidation (lib/declarationTva.ts, « CE QUE CE CALCUL NE FAIT PAS ») : la phrase
// le dit.

const AUTOLIQUIDATION = 'Mais la TVA d’un service qu’il achète à un prestataire établi hors de France — un logiciel en '
  + 'ligne, une formation, de la publicité — est due par lui (autoliquidation, art. 283, 2 du CGI) : il la déclare alors, '
  + 'avec un numéro de TVA intracommunautaire. L’application ne prépare pas encore cette déclaration.'

export function declarationDuNonRedevable(statut: StatutTva | null): string {
  switch (statut) {
    case 'franchise': return `En franchise en base, le dossier ne facture pas de TVA et n’en déclare pas sur ses ventes. ${AUTOLIQUIDATION}`
    case 'exonere': return `Exonéré, le dossier ne facture pas de TVA et n’en déclare pas sur ses opérations exonérées. ${AUTOLIQUIDATION}`
    // L'onglet prépare la CA3 d'un redevable : cette phrase ne le concerne que si l'écran le croit non assujetti.
    case 'redevable': return 'Redevable, le dossier prépare ses déclarations de TVA dans cet onglet.'
    case null: return 'Tant que son statut de TVA est à préciser, le dossier est traité comme ne récupérant pas la TVA : '
      + 'redevable, il préparerait ici ses déclarations.'
  }
}
