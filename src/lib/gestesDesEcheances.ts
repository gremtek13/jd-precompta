import type { LigneEcritureMouvement, MouvementBancaire } from './affectationBanque'
import {
  csgDeLEcriture, ecritureDeLaCotisation, montantDeLEcheance, refusRapprochementCotisation,
} from './cotisationRapprochee'
import { formatDate, formatMoney } from './format'
import type { PlanComptable } from './planComptable'
import type { CotisationDeclaree, EcritureBrouillon, ModeComptable } from './types'

// « MODIFIER » ET « RÉUNIR » UNE ÉCHÉANCE DE COTISATION (relecture du 03/11/2026, D1 et D5 ; COT-Q1 et COT-Q3, écrites sur la
// recommandation le 04/11/2026). Les règles et les mots, ici ; l'onglet Cotisations les montre avant le clic et écrit.
//
// « MODIFIER » (COT-Q3) : l'onglet n'offrait que « Ajouter » et « Retirer ». Corriger une CSG-CRDS connue après coup (le
// décompte annuel), poser 0 sur une caisse de retraite que l'avertissement « CSG-CRDS non saisie » citait à tort, poser un
// versé de 0 € sur une mensualité couverte par un crédit : il fallait retirer l'échéance — ce qui remet son prélèvement à
// traiter et retire son écriture —, la ressaisir et la rapprocher de nouveau. Une mise à jour directe suffit : la policy
// `cotisations_declarees_all` la permet au cabinet, et deux déclencheurs la jugent — `garder_cotisation_valide` (« % : cette
// échéance ne change plus. », et une date d'un exercice figé sans mouvement : « % : une échéance ne s'y ajoute plus. ») et
// `garder_paiement_personnel` (les montants d'une échéance payée depuis le compte personnel ne changent pas tant que ce
// paiement tient). Ces refus se disent ici avant le clic, sous les mots de la base.
//
// SUR UNE ÉCHÉANCE RAPPROCHÉE, LA RÈGLE LA PLUS SÛRE QUE LA BASE PERMET : le rapprochement reste — le relevé fait foi, et la
// 2035 compte le mouvement, à sa date et pour son montant (`cotisationsComptees`) ; un rapprochement à la main accepte déjà
// un montant différent (807 € prélevés pour 800 € appelés). Mais rien ne passe qui le rendrait INÉCRIVABLE : des montants
// que `rapprocher_cotisation` refuserait (le sens, le zéro, une CSG-CRDS plus forte que le mouvement) se refusent avant le
// clic, et le geste conseillé est d'annuler le rapprochement dans Banque. Une CSG-CRDS changée en trésorerie change son
// écriture : elle se réécrit DANS LE MÊME GESTE, par la même fonction que « Écrire les N », après la mise à jour — et si
// cette réécriture échoue, l'échéance est modifiée et « Écrire cette échéance » la propose, comme pour toute CSG-CRDS saisie
// après le rapprochement. Une écriture validée ne se remplace plus (les mots de `rapprocher_cotisation`) : refusé avant.
//
// « RÉUNIR » (COT-Q1) : un prélèvement qui paie deux échéances (la mensualité et une régularisation) ne se rapproche que d'une
// (`lignes_bancaires.cotisation_id`) ; rapproché de la mensualité, il la compte pour SON montant, et la régularisation compte
// encore à son échéance — deux fois la même somme dans BK. Avant le rapprochement, les deux échéances deviennent une seule,
// à leur somme, CSG-CRDS comprise. La liaison d'un mouvement à plusieurs échéances demandera une migration, après le MVP.
//
// SES CONDITIONS, et pourquoi :
//   - deux échéances qu'AUCUN MOUVEMENT ne paie : la réunion ne touche alors à aucune écriture (une échéance rapprochée se
//     porte à la somme par « Modifier », qui réécrit son écriture, puis l'autre se retire) ;
//   - ni payées depuis le compte personnel (la base fige leurs montants), ni figées par la validation (elle refuse) ;
//   - DÉFINITIVES : une prévisionnelle est une estimation que l'appel définitif remplace (lib/previsionnelles.ts) — réunie,
//     elle ne se remplacerait plus ;
//   - du MÊME SENS (deux appels, ou deux remboursements) et non nulles ;
//   - leurs CSG-CRDS toutes deux saisies, ou toutes deux non saisies : une saisie et une inconnue donneraient une somme qui
//     se croirait complète ;
//   - DU MÊME ORGANISME : la base ne porte pas l'organisme d'une échéance (la colonne `nature` de COT-Q3, D3, viendra après
//     le MVP). La confirmation le demande au cabinet, en le disant.
//
// DEUX ÉCRITURES, PAS TOUT OU RIEN — l'ordre : L'ÉCHÉANCE GARDÉE D'ABORD, portée à la somme ; L'AUTRE ENSUITE, retirée.
// Un échec entre les deux laisse les deux échéances en base, la gardée à la somme : la somme compte deux fois, mais RIEN
// N'EST PERDU, l'écran le montre (les deux lignes, la seconde marquée « à retirer », et un message qui nomme le seul geste
// qui finit le travail, montants compris), et si la page se ferme avant, l'échéance restée, que rien ne paie, compte à son
// échéance : Clôture la liste (« Cotisations comptées à leur échéance ») et la concordance retient la validation. L'ordre
// inverse perdrait, sur le même échec, les montants de l'échéance retirée — une CSG-CRDS que rien ne redirait.

const centimes = (n: number) => Math.round(n * 100)
const auCentime = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6
const DATE_CIVILE = /^\d{4}-\d{2}-\d{2}$/

/** Ce qu'une modification ou une réunion écrit sur une échéance. */
export type ValeursDeLEcheance = Pick<CotisationDeclaree, 'echeance' | 'montant_appele' | 'montant_verse' | 'montant_csg_crds' | 'previsionnel'>

/** La saisie de la fenêtre « Modifier », telle que tapée. */
export interface SaisieDeLEcheance {
  echeance: string
  appele: string
  verse: string
  csg: string
  previsionnel: boolean
}

/** Ce que l'onglet a lu, EN ENTIER, pour juger un geste : sur une lecture partielle, il n'en offre aucun. */
export interface ContexteDesGestes {
  mode: ModeComptable
  plan: PlanComptable
  // Le mouvement qui paie l'échéance, lu dans un relevé lu en entier ; nul : aucun ne la paie.
  mouvementDe: (c: CotisationDeclaree) => MouvementBancaire | null
  // L'exercice validé qui fige l'échéance — la date du mouvement qui la paie, sinon de son paiement personnel, sinon son
  // échéance —, dit comme la base (`exercice_fige`) ; nul quand elle ne l'est pas.
  figee: (c: CotisationDeclaree) => string | null
  // L'exercice validé qui fige une date, dit comme la base ; nul sinon.
  dateFigee: (date: string) => string | null
  // Le brouillon du dossier, lu en entier : il dit si l'écriture d'un mouvement est validée.
  ecritures: readonly EcritureBrouillon[]
}

export interface RefusDuGeste {
  message: string
  // Un refus qui n'est pas une faute — rien n'a changé — se dit discrètement.
  discret?: boolean
}

/** La saisie pré-remplie d'une échéance, telle qu'elle est en base. */
export function saisieDe(c: CotisationDeclaree): SaisieDeLEcheance {
  const texte = (n: number | null) => (n == null ? '' : String(n))
  return {
    echeance: c.echeance, appele: texte(c.montant_appele), verse: texte(c.montant_verse), csg: texte(c.montant_csg_crds),
    previsionnel: c.previsionnel,
  }
}

type Lu = { ok: true; valeur: number | null } | { ok: false; message: string }

// Un montant tapé : vide, il n'est pas saisi ; sinon un nombre au centime, la virgule admise. Jamais arrondi en silence.
function lireMontant(texte: string, nom: string): Lu {
  const t = texte.trim().replace(',', '.')
  if (t === '') return { ok: true, valeur: null }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, message: `${nom} n’est pas un montant.` }
  const n = Number(t)
  if (!Number.isFinite(n)) return { ok: false, message: `${nom} n’est pas un montant.` }
  if (!auCentime(n)) return { ok: false, message: `${nom} n’est pas au centime.` }
  return { ok: true, valeur: n }
}

function dateValide(texte: string): boolean {
  if (!DATE_CIVILE.test(texte)) return false
  const [a, m, j] = texte.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, j))
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j && a >= 2000
}

/** La saisie lue en valeurs, ou ce qui l'en empêche. */
export function lireLaSaisie(s: SaisieDeLEcheance): { valeurs: ValeursDeLEcheance } | { refus: RefusDuGeste } {
  if (!dateValide(s.echeance)) return { refus: { message: 'L’échéance est à renseigner : une date, à partir de l’an 2000.' } }
  const appele = lireMontant(s.appele, 'Le montant appelé')
  if (!appele.ok) return { refus: { message: appele.message } }
  if (appele.valeur === null) return { refus: { message: 'Le montant appelé est à renseigner.' } }
  const verse = lireMontant(s.verse, 'Le montant versé')
  if (!verse.ok) return { refus: { message: verse.message } }
  const csg = lireMontant(s.csg, 'La CSG-CRDS')
  if (!csg.ok) return { refus: { message: csg.message } }
  return {
    valeurs: {
      echeance: s.echeance, montant_appele: appele.valeur, montant_verse: verse.valeur, montant_csg_crds: csg.valeur,
      previsionnel: s.previsionnel,
    },
  }
}

// Les mots de `garder_paiement_personnel` (migration `paiement_personnel_des_cotisations`), au caractère près.
export function refusDuPaiementPersonnel(datePaiement: string): string {
  return `Cette échéance est payée depuis le compte personnel, le ${formatDate(datePaiement)} : ni ses montants ni son dossier ne changent tant que ce paiement n’est pas retiré.`
}

const natureDu = (m: Pick<MouvementBancaire, 'montant'>) => (m.montant > 0 ? 'remboursement' : 'prélèvement')
const leMouvement = (m: Pick<MouvementBancaire, 'montant' | 'date'>) =>
  `le ${natureDu(m)} du ${formatDate(m.date)} (${formatMoney(Math.abs(m.montant))})`

// L'écriture validée d'un mouvement — celle que `rapprocher_cotisation` ne remplace plus : ses lignes propres (ni pièce, ni
// facture, ni encaissement) qui ne sont plus « proposée ».
function ecritureValideeDu(ligne: Pick<MouvementBancaire, 'id'>, ecritures: readonly EcritureBrouillon[]): boolean {
  return ecritures.some((e) => e.ligne_bancaire_id === ligne.id && e.piece_id == null && e.facture_id == null
    && e.encaissement_id == null && e.statut !== 'proposee')
}

const memesValeurs = (c: CotisationDeclaree, v: ValeursDeLEcheance) =>
  c.echeance === v.echeance && c.montant_appele === v.montant_appele && c.montant_verse === v.montant_verse
  && c.montant_csg_crds === v.montant_csg_crds && c.previsionnel === v.previsionnel

export type JugementDeLaModification =
  | { refus: RefusDuGeste }
  | {
    valeurs: ValeursDeLEcheance
    // Ce que le geste change, dit avant le clic : au rapprochement, à ce que la 2035 compte, à la CSG-CRDS.
    effets: string[]
    // L'écriture que la base réécrira dans le même geste (une échéance rapprochée dont la CSG-CRDS change en trésorerie),
    // avec le mouvement qui la porte ; nulle quand l'écriture ne change pas.
    reecriture: { ligne: MouvementBancaire; ecritures: LigneEcritureMouvement[] } | null
  }

// JUGER UNE MODIFICATION, sur la saisie TELLE QU'ELLE PARTIRAIT : d'abord ce que la base refuse, sous ses mots, puis ce qui
// rendrait le rapprochement inécrivable, puis ce que le geste change.
export function jugerLaModification(
  c: CotisationDeclaree, saisie: SaisieDeLEcheance, ctx: ContexteDesGestes,
): JugementDeLaModification {
  const figee = ctx.figee(c)
  if (figee) return { refus: { message: `${figee} : cette échéance ne change plus.` } }
  // Les montants seuls sont gardés par la base ; la date non, mais l'écriture du paiement porte la date de l'échéance dans
  // son libellé : changée, elle serait « à reprendre ». Le paiement se retire d'abord, dans les deux cas.
  if (c.paiement_personnel_le) {
    return { refus: { message: `${refusDuPaiementPersonnel(c.paiement_personnel_le)} Retire d’abord ce paiement.` } }
  }
  const lue = lireLaSaisie(saisie)
  if ('refus' in lue) return lue
  const v = lue.valeurs
  if (memesValeurs(c, v)) return { refus: { message: 'Rien n’a changé.', discret: true } }

  const mouvement = ctx.mouvementDe(c)
  // Une date d'un exercice figé : la base la refuse à une échéance que rien ne paie ; payée par un mouvement, elle
  // l'accepterait, mais l'échéance y compterait si ce rapprochement était un jour annulé — refusée de même, sous les mêmes mots.
  const dateNeuve = v.echeance !== c.echeance ? ctx.dateFigee(v.echeance) : null
  if (dateNeuve) return { refus: { message: `${dateNeuve} : une échéance ne s’y ajoute plus.` } }

  const montant = montantDeLEcheance(v)
  if (v.montant_csg_crds != null && centimes(Math.abs(v.montant_csg_crds)) > centimes(Math.abs(montant))) {
    return {
      refus: {
        message: `La CSG-CRDS (${formatMoney(Math.abs(v.montant_csg_crds))}) dépasse le montant de l’échéance (${formatMoney(Math.abs(montant))}).`,
      },
    }
  }

  const effets: string[] = []
  let reecriture: { ligne: MouvementBancaire; ecritures: LigneEcritureMouvement[] } | null = null
  if (mouvement) {
    const refus = refusRapprochementCotisation(mouvement, { ...c, ...v }, ctx.mode)
    if (refus) {
      return {
        refus: {
          message: `${refus} ${majuscule(leMouvement(mouvement))}, qui la paie, ne pourrait plus s’écrire : garde des montants qu’il accepte, ou annule d’abord ce rapprochement dans l’onglet Banque.`,
        },
      }
    }
    const avant = ecritureDeLaCotisation(mouvement, c, ctx.mode, ctx.plan)
    const apres = ecritureDeLaCotisation(mouvement, v, ctx.mode, ctx.plan)
    const change = JSON.stringify(avant.map(({ compte, sens, montant: m }) => [compte, sens, m]))
      !== JSON.stringify(apres.map(({ compte, sens, montant: m }) => [compte, sens, m]))
    if (change && ecritureValideeDu(mouvement, ctx.ecritures)) {
      return { refus: { message: 'L’écriture de ce mouvement est validée : elle ne se remplace plus.' } }
    }
    effets.push(`${majuscule(leMouvement(mouvement))}, qui la paie, reste rapproché : la 2035 la compte toujours à cette date, pour ce montant.`)
    if (centimes(Math.abs(montant)) !== centimes(Math.abs(mouvement.montant))) {
      effets.push(`Son montant (${formatMoney(Math.abs(montant))}) ne correspond pas à ce ${natureDu(mouvement)} : vérifie qu’il la paie bien, sinon annule ce rapprochement dans l’onglet Banque.`)
    }
    if (change) {
      const csg = csgDeLEcriture(v, ctx.mode)
      const net = Math.abs(mouvement.montant) - csg
      effets.push(
        `Son écriture est réécrite dans le même geste : ${formatMoney(net)} au ${ctx.plan.cotisations_exploitant}`
        + (csg > 0 ? `, ${formatMoney(csg)} de CSG-CRDS au ${ctx.plan.exploitant}` : '')
        + ', face à la banque.',
      )
      reecriture = { ligne: mouvement, ecritures: apres }
    } else if (ctx.mode === 'engagement' && c.montant_csg_crds !== v.montant_csg_crds) {
      effets.push(`Son écriture ne change pas : en engagement, la CSG-CRDS reste au ${ctx.plan.cotisations_exploitant}.`)
    }
  } else {
    effets.push(`Aucun mouvement ne la paie : elle compte à son échéance, le ${formatDate(v.echeance)}, pour ${formatMoney(montant)}, tant qu’aucun paiement ne la date.`)
  }

  if (c.montant_csg_crds !== v.montant_csg_crds) {
    if (v.montant_csg_crds === null) {
      effets.push('Sans CSG-CRDS saisie, l’échéance est « sans ventilation » : la 2035 ne sort rien d’elle de BK, et la Clôture la cite parmi les cotisations dont la CSG-CRDS n’est pas saisie.')
    } else if (v.montant_csg_crds === 0) {
      effets.push('Une CSG-CRDS de 0 € dit que l’organisme n’en prélève pas : l’échéance n’est plus « sans ventilation ».')
    } else {
      effets.push(`Sa CSG-CRDS (${formatMoney(Math.abs(v.montant_csg_crds))}) sort de BK, et sa part déductible entre en BV.`)
    }
  }
  return { valeurs: v, effets, reecriture }
}

function majuscule(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Réunir ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Pourquoi cette échéance ne se réunit pas, ou rien. */
export function raisonDeNePasReunir(c: CotisationDeclaree, ctx: ContexteDesGestes): string | null {
  const figee = ctx.figee(c)
  if (figee) return `${figee} : cette échéance ne change plus.`
  if (c.paiement_personnel_le) return refusDuPaiementPersonnel(c.paiement_personnel_le)
  const mouvement = ctx.mouvementDe(c)
  if (mouvement) {
    return `Elle est rapprochée du ${natureDu(mouvement)} du ${formatDate(mouvement.date)} : une échéance rapprochée ne se réunit pas — porte-la à la somme avec « Modifier », puis retire l’autre.`
  }
  if (c.previsionnel) return 'Une échéance prévisionnelle ne se réunit pas : l’appel définitif la remplace d’abord.'
  if (montantDeLEcheance(c) === 0) return 'Une échéance de zéro euro n’a rien à réunir.'
  return null
}

const sens = (c: CotisationDeclaree) => Math.sign(montantDeLEcheance(c))

/** Les échéances qu'on peut réunir à celle-ci : chacune réunissable, du même sens. */
export function candidatesALaReunion(
  gardee: CotisationDeclaree, cotisations: readonly CotisationDeclaree[], ctx: ContexteDesGestes,
): CotisationDeclaree[] {
  if (raisonDeNePasReunir(gardee, ctx) !== null) return []
  return cotisations.filter((c) => c.id !== gardee.id && raisonDeNePasReunir(c, ctx) === null && sens(c) === sens(gardee))
}

/** Pourquoi ces deux échéances ne se réunissent pas, ou rien : la seconde est celle qui se retire. */
export function refusDeLaReunion(gardee: CotisationDeclaree, retiree: CotisationDeclaree, ctx: ContexteDesGestes): string | null {
  if (gardee.id === retiree.id) return 'Une échéance ne se réunit pas à elle-même.'
  for (const c of [gardee, retiree]) {
    const raison = raisonDeNePasReunir(c, ctx)
    if (raison) return `L’échéance du ${formatDate(c.echeance)} : ${raison}`
  }
  if (sens(gardee) !== sens(retiree)) return 'Un appel et un remboursement ne se réunissent pas.'
  for (const c of [gardee, retiree]) {
    if (![c.montant_appele, c.montant_verse, c.montant_csg_crds].every((m) => m == null || auCentime(m))) {
      return `Les montants de l’échéance du ${formatDate(c.echeance)} ne sont pas au centime : corrige-les avec « Modifier ».`
    }
  }
  if ((gardee.montant_csg_crds == null) !== (retiree.montant_csg_crds == null)) {
    const sans = gardee.montant_csg_crds == null ? gardee : retiree
    return `La CSG-CRDS de l’échéance du ${formatDate(sans.echeance)} n’est pas saisie : saisis-la avec « Modifier » (0 si l’organisme n’en prélève pas), puis réunis.`
  }
  return null
}

/** Les montants de l'échéance gardée une fois réunie : les sommes, en centimes. Sa date reste la sienne. */
export function valeursReunies(gardee: CotisationDeclaree, retiree: CotisationDeclaree): ValeursDeLEcheance {
  const somme = (a: number, b: number) => (centimes(a) + centimes(b)) / 100
  return {
    echeance: gardee.echeance,
    montant_appele: somme(gardee.montant_appele, retiree.montant_appele),
    // Un versé saisi sur l'une seulement : la somme de ce que chacune pèse (le versé, sinon l'appelé).
    montant_verse: gardee.montant_verse == null && retiree.montant_verse == null
      ? null
      : somme(montantDeLEcheance(gardee), montantDeLEcheance(retiree)),
    montant_csg_crds: gardee.montant_csg_crds == null || retiree.montant_csg_crds == null
      ? null
      : somme(Math.abs(gardee.montant_csg_crds), Math.abs(retiree.montant_csg_crds)),
    previsionnel: false,
  }
}

function montantsDits(v: Pick<CotisationDeclaree, 'montant_appele' | 'montant_verse' | 'montant_csg_crds'>): string {
  return `${formatMoney(v.montant_appele)} appelés`
    + (v.montant_verse != null ? `, ${formatMoney(v.montant_verse)} versés` : '')
    + (v.montant_csg_crds != null ? `, dont ${formatMoney(Math.abs(v.montant_csg_crds))} de CSG-CRDS` : ', CSG-CRDS non saisie')
}

/** La confirmation de la réunion : ce qui reste, à quelle date, pour quels montants, et ce qui part. */
export function confirmationDeLaReunion(
  gardee: CotisationDeclaree, retiree: CotisationDeclaree, avisDeLaRetiree: string | null,
): string {
  const v = valeursReunies(gardee, retiree)
  return `L’échéance du ${formatDate(gardee.echeance)} est gardée, à sa date, et portée à ${montantsDits(v)}. `
    + `Celle du ${formatDate(retiree.echeance)} (${montantsDits(retiree)}) est retirée : aucun mouvement ne la paie.`
    + (avisDeLaRetiree ? ` Son avis « ${avisDeLaRetiree} » redevient non rattaché.` : '')
    + ' Ne réunis que deux échéances d’un même organisme qu’un même prélèvement paie : l’application ne connaît pas l’organisme d’une échéance.'
}

/** Une réunion arrêtée entre ses deux écritures : la gardée porte la somme, l'autre est restée. */
export interface ReunionInachevee {
  // Telle qu'elle était lue AVANT la réunion : la somme qu'elle porte désormais se recalcule (`valeursReunies`).
  gardee: CotisationDeclaree
  retiree: CotisationDeclaree
  raison: string
}

/** Ce que l'écran dit d'une réunion inachevée : l'état, et le seul geste qui la finit, montants compris. */
export function reunionInacheveeDite(r: ReunionInachevee): string {
  const v = valeursReunies(r.gardee, r.retiree)
  const poids = formatMoney(Math.abs(montantDeLEcheance(r.retiree)))
  return `Réunion inachevée : l’échéance du ${formatDate(r.gardee.echeance)} porte déjà ${montantsDits(v)}, mais celle du `
    + `${formatDate(r.retiree.echeance)} (${montantsDits(r.retiree)}) n’a pas pu être retirée : ${r.raison}. `
    + `Tant qu’elle reste, ses ${poids} comptent deux fois. Retire l’échéance du ${formatDate(r.retiree.echeance)} pour finir.`
}
