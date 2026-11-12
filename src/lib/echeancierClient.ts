import { SEUIL_ANNEXE_2035E, SEUIL_CVAE_A_PAYER } from './declaration2035E'
import {
  CALENDRIER_IS_EXPORTE, DELAI_TELEDECLARATION_JOURS, SEUIL_ACOMPTE_CFE, SEUIL_ACOMPTES_CVAE, echeanceDuModeComptable, estEcheanceDeLImpot, euros,
  prochainesEcheancesDuDossier, type EcheanceDeLImpot, type EcheanceFiscale, type ImpotDuDossier,
} from './echeancesFiscales'
import { ajouterJours } from './format'
import { PREMIERE_CLOTURE_A_CONFIRMER } from './impotSurLesSocietes'
import type { CotisationDeclaree, ModeComptable, PeriodiciteTva, StatutTva } from './types'

// L'ÉCHÉANCIER FISCAL ET SOCIAL DU CLIENT (ligne 51.5, partie C, étape C1 ; MEG3-Q1 : « oui, en premier »). Ce que le client
// va devoir déclarer ou payer, et quand, sur les douze mois qui viennent (aujourd'hui compris) : le calendrier de la CFE, de
// la CVAE et de la 2035 (`lib/echeancesFiscales.ts`, ses DATES reprises telles quelles), la CA3 d'un dossier redevable selon
// sa périodicité, les échéances à venir de ses cotisations. Module PUR : ni base, ni horloge — « aujourd'hui » (au jour de
// Paris) est un paramètre, la lecture vit dans `lib/echeancierClientLecture.ts`.
//
// Trois règles :
// - Les DATES pour tout accès ; les MONTANTS seulement quand l'appelant les lui ouvre (`avecMontants` : la case « Banque »,
//   comme « Ma simulation ») — une règle d'écran : la base laisse lire `cotisations_declarees` à tout accès, et rien ne
//   s'ouvre de neuf. Sans elle, aucun montant ne sort d'ici, ni la lecture ne le demande.
// - Les mots du client : tutoiement, aucun nom d'onglet (`MOTS_DU_CABINET`, gardé par le test). Les textes de la Checklist
//   du cabinet sont redits ici, échéance par échéance ; une condition reste une condition (« si … »), jamais tranchée à la
//   place du cabinet, qui seul sait la CFE de l'an dernier ou la création d'un établissement.
// - Une échéance prévisionnelle de cotisation est une ESTIMATION de la caisse, dite comme telle, jamais un montant connu.
//
// Hors de ce lot : l'e-reporting (à partir du 01/09/2027), le montant d'une CA3 que le cabinet a préparée (les déclarations
// de TVA ne se lisent qu'au cabinet : il faudrait la fonction `echeancier_du_dossier` de la conception, une migration).

export type NatureEcheance = 'impots' | 'tva' | 'cotisations'

export interface MontantDEcheance {
  valeur: number
  // Vrai pour une échéance prévisionnelle : l'estimation de la caisse, pas l'appel.
  estimation: boolean
}

export interface EcheanceDuClient {
  id: string
  nature: NatureEcheance
  // AAAA-MM-JJ sur le calendrier civil. Quand `auMois` est vrai, le premier jour du mois : le jour n'est pas connu.
  date: string
  // Vrai quand seul le MOIS est sûr (la CA3 : son jour limite dépend de l'entreprise).
  auMois: boolean
  libelle: string
  // La condition, ou ce qu'il faut savoir ; nulle quand il n'y a rien à ajouter.
  precision: string | null
  // Nul sans « Banque », et pour ce qui n'a pas de montant connu ici (les impôts, la TVA).
  montant: MontantDEcheance | null
  prevision: boolean
}

// Ce que le module lit du dossier. Nul : le dossier n'a pas pu être lu, la TVA n'est pas dite (l'écran dit la lecture).
export interface DossierDeLEcheancier {
  statut_tva: StatutTva | null
  tva_periodicite: PeriodiciteTva
  // Le modèle comptable : en engagement (BIC, IS) il n'y a pas de 2035 (`echeanceDuModeComptable`, la règle de la Checklist).
  mode_comptable: ModeComptable
}

// Ce que le module lit d'une échéance de cotisation : le montant appelé n'est lu qu'avec « Banque ».
export type CotisationDeLEcheancier = Pick<CotisationDeclaree, 'id' | 'echeance' | 'previsionnel' | 'paiement_personnel_le'>
  & { montant_appele?: number | null }

export interface Echeancier {
  echeances: EcheanceDuClient[]
  // Dit quand le dossier est lu mais que son statut de TVA n'est pas encore posé : la TVA n'y figure pas, et l'écran le dit.
  avisTva: string | null
  // Dit quand une échéance d'impôt sur les sociétés ne peut pas figurer (régime d'un exercice pas encore dit, exercice
  // décalé) ; toujours nul tant que `CALENDRIER_IS_EXPORTE` est baissé.
  avisImpot: string | null
}

export const AVIS_TVA_A_PRECISER =
  'Ton cabinet n’a pas encore précisé ta situation de TVA : tes déclarations de TVA ne figurent pas encore ici.'

// La fenêtre : d'aujourd'hui (inclus) à aujourd'hui plus 365 jours (exclu), la même que celle de la Checklist
// (`prochainesEcheances`), pour qu'en décembre la 2035 de mai suivant y soit déjà.
export function finDeLaFenetre(aujourdHui: string): string {
  return ajouterJours(aujourdHui, 365)
}

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

// « de mai », « d’avril », « d’août », « d’octobre ».
function deMois(mois: number): string {
  const nom = NOMS_MOIS[mois - 1]
  return /^[aeiouy]/.test(nom) ? `d’${nom}` : `de ${nom}`
}

export function moisEnLettres(date: string): string {
  return `${NOMS_MOIS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
}

// ── Le fiscal, aux mots du client ──────────────────────────────────────────────────────────────────────────────────────
// Une échéance de `echeancesFiscales` se reconnaît à son identifiant, `<nature>-<année>`. Toute nature y a ses mots (le test
// le vérifie sur plusieurs années) ; une nature qu'on ajouterait là-bas sans l'ajouter ici garde les mots du cabinet plutôt
// que de disparaître : une échéance tue serait pire qu'une phrase moins tournée vers le client.
type NatureFiscale =
  | 'liasse' | 'cvae-solde' | 'cfe-1447m' | 'cfe-acompte' | 'cvae-acompte-juin' | 'cvae-acompte-septembre' | 'cfe-solde'
  | 'cfe-1447c'

const AVIS_EN_LIGNE = 'L’avis est dans ton espace professionnel sur impots.gouv.fr.'

const MOTS_FISCAUX: Record<NatureFiscale, (annee: number) => { libelle: string; precision: string }> = {
  liasse: (a) => ({
    libelle: `Déclaration de tes revenus ${a - 1} (2035), déposée par ton cabinet`,
    precision: `Ton cabinet la télédéclare pour toi, avec son annexe 2035-E si ton chiffre d’affaires hors taxes de ${a - 1} `
      + `dépasse ${euros(SEUIL_ANNEXE_2035E)}. Date limite en ligne : le deuxième jour ouvré après le 1er mai, plus `
      + `${DELAI_TELEDECLARATION_JOURS} jours.`,
  }),
  'cvae-solde': (a) => ({
    libelle: `CVAE ${a - 1} : déclaration de liquidation (1329-DEF) et paiement du solde`,
    precision: `Seulement si ton chiffre d’affaires hors taxes de ${a - 1} dépasse ${euros(SEUIL_CVAE_A_PAYER)} ; en dessous, la CVAE est nulle.`,
  }),
  'cfe-1447m': (a) => ({
    libelle: `CFE : déclaration modificative (1447-M), pour la CFE ${a + 1}`,
    precision: 'Seulement si tes locaux ont changé de surface ou d’usage, ou pour demander une exonération : parles-en à ton cabinet.',
  }),
  'cfe-acompte': (a) => ({
    libelle: `CFE ${a} : acompte de la moitié de ta CFE ${a - 1}`,
    precision: `Seulement si ta CFE de ${a - 1} atteignait ${euros(SEUIL_ACOMPTE_CFE)}, et si tu ne la paies pas par prélèvement `
      + `mensuel. ${AVIS_EN_LIGNE}`,
  }),
  'cvae-acompte-juin': (a) => ({
    libelle: `CVAE ${a} : premier acompte (1329-AC)`,
    precision: `Seulement si ta CVAE de ${a - 1} dépassait ${euros(SEUIL_ACOMPTES_CVAE)}.`,
  }),
  'cvae-acompte-septembre': (a) => ({
    libelle: `CVAE ${a} : second acompte (1329-AC)`,
    precision: `Seulement si ta CVAE de ${a - 1} dépassait ${euros(SEUIL_ACOMPTES_CVAE)}.`,
  }),
  'cfe-solde': (a) => ({
    libelle: `CFE ${a} : paiement`,
    precision: `Due chaque année, sauf exonération, et sauf l’année où tu crées ton établissement. ${AVIS_EN_LIGNE} Paiement en `
      + 'ligne ou par prélèvement.',
  }),
  'cfe-1447c': (a) => ({
    libelle: `CFE : déclaration initiale (1447-C), pour la CFE ${a + 1}`,
    precision: `Seulement si tu as créé ou repris un établissement en ${a} : ton cabinet te le dira.`,
  }),
}

/** Les mots du client pour une échéance du calendrier fiscal ; `null` pour une nature que ce module ne connaît pas. */
export function motsDuClientPour(echeance: EcheanceFiscale): { libelle: string; precision: string } | null {
  const m = /^(.+)-(\d{4})$/.exec(echeance.id)
  if (!m || !(m[1] in MOTS_FISCAUX)) return null
  return MOTS_FISCAUX[m[1] as NatureFiscale](Number(m[2]))
}

// ── L'impôt sur les sociétés (ligne 38, LIA8, derrière `CALENDRIER_IS_EXPORTE`) ────────────────────────────────────────
// Les acomptes (2571) et le solde (2572) du calendrier (`lib/echeancesFiscales.ts`), aux mots du client. Le montant ne sort
// qu'avec « Banque », et seulement quand le calendrier en a un ; une raison du cabinet (une saisie qui manque, un calcul
// refusé) ne se recopie pas : le client lit que son cabinet le lui dira. Un barème que la loi de finances pour 2027 peut
// changer (LIA3-Q1) fait du montant une estimation, dite comme telle.
export const AVIS_IMPOT_A_PRECISER =
  'Ton cabinet n’a pas encore précisé l’impôt sur les sociétés de chaque exercice : certaines de ses échéances ne figurent pas encore ici.'

const ORDINAUX_DES_ACOMPTES = ['premier', 'deuxième', 'troisième', 'quatrième']

export function motsDuClientPourLImpot(e: EcheanceDeLImpot): { libelle: string; precision: string } {
  const libelle = e.numero === null
    ? `Impôt sur les sociétés ${e.exercice} : solde (relevé 2572)`
    : `Impôt sur les sociétés ${e.exercice} : ${ORDINAUX_DES_ACOMPTES[e.numero - 1]} acompte (relevé 2571)`
  const aPayer = `À payer dans ton espace professionnel sur impots.gouv.fr.`
  const precision = e.montant.etat === 'du'
    ? `${aPayer}${baremeAConfirmer(e) ? ' Montant calculé sur le barème connu aujourd’hui, que la loi de finances pour 2027 peut changer.' : ''}`
    : e.montant.etat === 'rien-a-payer'
      ? e.montant.excedent > 0
        ? 'Rien à payer : tes acomptes dépassent ton impôt, l’excédent te sera remboursé.'
        : 'Rien à payer à cette échéance, d’après les chiffres de ton cabinet.'
      : `Le montant n’est pas encore connu ici : ton cabinet te le dira. ${aPayer}`
  const jour = e.jourNonOuvre
    ? ' Cette date tombe un jour non ouvré : c’est pourtant la date légale, ton cabinet te dira s’il faut payer avant.'
    : ''
  return { libelle, precision: `${precision}${jour}` }
}

function baremeAConfirmer(e: EcheanceDeLImpot): boolean {
  return `${e.exercice}-12-31` >= PREMIERE_CLOTURE_A_CONFIRMER
}

function echeanceDeLImpotDuClient(e: EcheanceDeLImpot, avecMontants: boolean): EcheanceDuClient {
  const mots = motsDuClientPourLImpot(e)
  return {
    id: e.id, nature: 'impots', date: e.date, auMois: false, libelle: mots.libelle, precision: mots.precision,
    // Sans « Banque », aucun montant ; un montant inconnu ou nul n'en est pas un.
    montant: avecMontants && e.montant.etat === 'du' ? { valeur: e.montant.centimes / 100, estimation: baremeAConfirmer(e) } : null,
    prevision: false,
  }
}

function echeancesFiscalesDuClient(
  aujourdHui: string, impot: ImpotDuDossier, avecMontants: boolean, exporte: boolean, mode: ModeComptable | null,
): { echeances: EcheanceDuClient[]; avis: string[] } {
  const calendrier = prochainesEcheancesDuDossier(aujourdHui, impot, exporte)
  // Dossier non lu : le modèle comptable est inconnu, la 2035 ne s'affirme pas (le bandeau dit la lecture partielle) ;
  // les autres échéances du calendrier ne dépendent pas du modèle.
  const echeances = calendrier.echeances.filter((e) => (mode === null ? e.impot !== 'Liasse' : echeanceDuModeComptable(e, mode))).map((e): EcheanceDuClient => {
    if (estEcheanceDeLImpot(e)) return echeanceDeLImpotDuClient(e, avecMontants)
    const mots = motsDuClientPour(e) ?? { libelle: e.libelle, precision: e.condition }
    return {
      id: e.id, nature: 'impots', date: e.date, auMois: false, libelle: mots.libelle, precision: mots.precision,
      montant: null, prevision: false,
    }
  })
  return { echeances, avis: calendrier.avis }
}

// ── La TVA d'un dossier redevable ──────────────────────────────────────────────────────────────────────────────────────
// Une CA3 par période, déposée le mois qui la suit : le mois suivant pour une périodicité mensuelle, avril, juillet, octobre et
// janvier pour une trimestrielle. Le jour limite, du 15 au 24 de ce mois, dépend de la forme de l'entreprise, de son nom ou de
// son SIREN (CGI, annexe IV, art. 39) : l'échéancier ne le devine pas, il dit le mois et renvoie au cabinet. Franchise ou
// exonéré : aucune CA3. Statut pas encore posé : rien non plus, dit par `avisTva`.
const PRECISION_CA3 =
  'Le jour limite, entre le 15 et le 24 du mois, dépend de ton entreprise : ton cabinet te le précise.'

const TRIMESTRES = ['1er trimestre', '2e trimestre', '3e trimestre', '4e trimestre']
const MOIS_DES_TRIMESTRES = ['janvier à mars', 'avril à juin', 'juillet à septembre', 'octobre à décembre']

const JOUR_LIMITE_AU_PLUS_TOT = '15'
const JOUR_LIMITE_AU_PLUS_TARD = '24'

function premierDuMois(annee: number, mois: number): string {
  return `${annee}-${String(mois).padStart(2, '0')}-01`
}

function echeancesTva(aujourdHui: string, periodicite: PeriodiciteTva): EcheanceDuClient[] {
  const fin = finDeLaFenetre(aujourdHui)
  const resultat: EcheanceDuClient[] = []
  let annee = Number(aujourdHui.slice(0, 4))
  let mois = Number(aujourdHui.slice(5, 7))
  // Un mois de dépôt est dans la fenêtre tant que son jour limite PEUT l'être : son 24 n'est pas passé (le mois en cours
  // compte jusque-là), et son 15 est avant la fin de la fenêtre — sinon, en novembre, la CA3 de novembre suivant y entrerait,
  // treize mois de dépôt sur douze mois.
  for (let date = premierDuMois(annee, mois); date < fin; date = premierDuMois(annee, mois)) {
    if (`${date.slice(0, 8)}${JOUR_LIMITE_AU_PLUS_TARD}` >= aujourdHui && `${date.slice(0, 8)}${JOUR_LIMITE_AU_PLUS_TOT}` < fin) {
      // La période déclarée : le mois précédent, ou le trimestre qui vient de finir.
      const anneePeriode = mois === 1 ? annee - 1 : annee
      const moisPeriode = mois === 1 ? 12 : mois - 1
      if (periodicite === 'mensuelle') {
        resultat.push({
          id: `ca3-${anneePeriode}-${String(moisPeriode).padStart(2, '0')}`, nature: 'tva', date, auMois: true,
          libelle: `TVA ${deMois(moisPeriode)} ${anneePeriode} : déclaration (CA3) et paiement`,
          precision: PRECISION_CA3, montant: null, prevision: false,
        })
      } else if (moisPeriode % 3 === 0) {
        const trimestre = moisPeriode / 3 - 1
        resultat.push({
          id: `ca3-${anneePeriode}-t${trimestre + 1}`, nature: 'tva', date, auMois: true,
          libelle: `TVA du ${TRIMESTRES[trimestre]} ${anneePeriode} (${MOIS_DES_TRIMESTRES[trimestre]}) : déclaration (CA3) et paiement`,
          precision: PRECISION_CA3, montant: null, prevision: false,
        })
      }
    }
    mois += 1
    if (mois === 13) { mois = 1; annee += 1 }
  }
  return resultat
}

// ── Les cotisations ────────────────────────────────────────────────────────────────────────────────────────────────────
// Les échéances À VENIR de l'échéancier de ses caisses. Une échéance déjà payée depuis son compte personnel ne s'annonce plus.
const PRECISION_PREVISIONNELLE =
  'Prévisionnelle : une estimation de ta caisse, pas encore un appel. Le montant définitif viendra avec l’appel.'

function echeancesCotisations(
  aujourdHui: string, cotisations: readonly CotisationDeLEcheancier[], avecMontants: boolean,
): EcheanceDuClient[] {
  const fin = finDeLaFenetre(aujourdHui)
  return cotisations
    .filter((c) => c.echeance >= aujourdHui && c.echeance < fin && c.paiement_personnel_le === null)
    .map((c) => ({
      id: `cotisation-${c.id}`, nature: 'cotisations', date: c.echeance, auMois: false,
      libelle: c.previsionnel ? 'Cotisations sociales : échéance prévisionnelle' : 'Cotisations sociales : échéance',
      precision: c.previsionnel ? PRECISION_PREVISIONNELLE : null,
      // Sans « Banque », aucun montant, même si l'appelant en a passé un.
      montant: avecMontants && typeof c.montant_appele === 'number' && Number.isFinite(c.montant_appele)
        ? { valeur: c.montant_appele, estimation: c.previsionnel }
        : null,
      prevision: c.previsionnel,
    }))
}

// L'ordre : la date, puis (un même jour) les impôts, la TVA, les cotisations, puis l'identifiant — un tri TOTAL, pour que deux
// rendus des mêmes données se lisent dans le même ordre.
const RANG: Record<NatureEcheance, number> = { impots: 0, tva: 1, cotisations: 2 }

/**
 * L'échéancier des douze mois qui viennent. `dossier` nul (pas lu) : ni la TVA ni son avis. `avecMontants` faux : aucun
 * montant. `aujourdHui` : le jour de Paris, AAAA-MM-JJ. `impot` : obligatoire, `SANS_IMPOT_SUR_LES_SOCIETES` tant que le
 * régime ne se lit pas en base (LIA4) ; `calendrierIsExporte` ne sert qu'aux tests, qui jouent les deux états du drapeau.
 */
export function composerEcheancier(entree: {
  aujourdHui: string
  dossier: DossierDeLEcheancier | null
  cotisations: readonly CotisationDeLEcheancier[]
  avecMontants: boolean
  impot: ImpotDuDossier
  calendrierIsExporte?: boolean
}): Echeancier {
  const { aujourdHui, dossier, cotisations, avecMontants, impot } = entree
  const fiscal = echeancesFiscalesDuClient(aujourdHui, impot, avecMontants, entree.calendrierIsExporte ?? CALENDRIER_IS_EXPORTE,
    dossier?.mode_comptable ?? null)
  const echeances = [
    ...fiscal.echeances,
    ...(dossier?.statut_tva === 'redevable' ? echeancesTva(aujourdHui, dossier.tva_periodicite) : []),
    ...echeancesCotisations(aujourdHui, cotisations, avecMontants),
  ].sort((a, b) => a.date.localeCompare(b.date) || RANG[a.nature] - RANG[b.nature] || a.id.localeCompare(b.id))
  return {
    echeances, avisTva: dossier !== null && dossier.statut_tva === null ? AVIS_TVA_A_PRECISER : null,
    avisImpot: fiscal.avis.length > 0 ? AVIS_IMPOT_A_PRECISER : null,
  }
}

/** La date telle que le client la lit : « 15 juin 2027 », ou « courant novembre 2026 » quand seul le mois est sûr. */
export function dateEnLettres(echeance: Pick<EcheanceDuClient, 'date' | 'auMois'>): string {
  if (echeance.auMois) return `courant ${moisEnLettres(echeance.date)}`
  const jour = Number(echeance.date.slice(8, 10))
  return `${jour === 1 ? '1er' : jour} ${moisEnLettres(echeance.date)}`
}

// ── Les phrases de l'écran ─────────────────────────────────────────────────────────────────────────────────────────────
// Écrites ici pour que le test les passe toutes à `motsDuCabinet`. L'introduction s'affiche avant la lecture : elle n'affirme
// donc rien de ce qu'on n'a pas lu.
export const ECHEANCIER_INTRODUCTION =
  'Ce que tu vas devoir déclarer ou payer dans les douze mois qui viennent, et quand.'
export const ECHEANCIER_CONDITIONS =
  'Une échéance marquée « Seulement si » ne te concerne peut-être pas : ton cabinet sait si c’est ton cas.'
export const ECHEANCIER_SANS_MONTANTS =
  'Les montants de tes cotisations ne s’affichent qu’avec l’accès à ta banque, que ton cabinet peut t’ouvrir.'
export const ECHEANCIER_ILLISIBLE = 'Ton échéancier n’a pas pu être lu : recharge la page dans un moment.'
export const ECHEANCIER_VIDE = 'Aucune échéance sur les douze mois qui viennent.'
export const ECHEANCIER_LECTURE_PARTIELLE =
  'Recharge la page : il peut manquer des échéances ci-dessous, celles de ta TVA ou de tes cotisations.'
