import {
  REFUS_ACOMPTE, lignesDeLaFinale, preparerAcompte, refusDeLaFinale, type AcomptePrepare, type AcompteValide,
  type DemandeAcompte, type LigneTiree,
} from './acompteDevis'
import { nomDansUnRefus } from './articles'
import { dateDeLaBase, refusFacturationDevis } from './devis'
import { formatDate, formatMoney } from './format'
import { calculerTotaux } from './montantsFacture'
import type { Devis, ModeComptable, NatureArticle, StatutFacture, TypeFacture } from './types'

// FACTURER UN ACOMPTE ET LE SOLDE DEPUIS UN DEVIS ACCEPTÉ (espace client, étape P5b5a ; conception : HISTORIQUE.md,
// « L'ACOMPTE D'UN DEVIS : LA CONCEPTION (P5B) »), derrière `ACOMPTES_PREVUS` (lib/devis.ts) : la migration
// `acomptes_des_devis` est PRÉPARÉE, pas appliquée. Un module PUR — il ne lit rien, n'appelle personne, ne lit pas
// l'horloge — que la vue « Devis » des deux espaces lit (pages/dossier/DevisVue.tsx, DevisAcompteModal.tsx) : l'état
// d'acompte d'un devis (ses acomptes en vigueur, celui en brouillon, sa facture finale active), ce que les deux gestes
// demandent, ce qu'ils refuseraient — dans l'ordre et sous les mots de `facturer_acompte_devis` et de `facturer_devis`
// remplacée, que acomptesDuDevis.test.ts confronte au texte de la migration préparée — et les mots de leurs
// confirmations. Les calculs sont ceux de lib/acompteDevis.ts (`preparerAcompte`, `lignesDeLaFinale`), jamais recopiés.
//
// LES RÉPONSES SUIVIES, sur la recommandation, en attendant le cabinet : P5B-Q1 (un pourcentage ou un TTC, au choix, le TTC
// exact dit avant le clic), P5B-Q2 (plusieurs acomptes, un seul en brouillon), P5B-Q3 (l'engagement refusé), P5B-Q4 (une
// finale créditée en entier laisse tirer une nouvelle finale), P5B2-Q1 (la date du versement facultative, jamais après le
// jour de Paris), P5B2-Q3 (les refus de la base dits avant le clic, aux mêmes mots), P5B3-Q1 (B) (pas d'acompte sur un
// devis de biens, ci-dessous).

// ── Ce que la lecture rend (lib/acomptesDuDevisLecture.ts) ─────────────────────────────────────────────────────────────
/** Un lien d'un devis à une facture, avec son rôle (`devis_factures.role`, posé par la migration). */
export interface LienDuDevis {
  id: string
  devis_id: string
  facture_id: string
  cree_le: string
  role: 'acompte' | 'finale'
}

/** Une facture ou un avoir du dossier, ce que l'état d'acompte d'un devis en demande. */
export interface FactureDuDevis {
  id: string
  numero: string | null
  statut: StatutFacture
  type: TypeFacture
  date_emission: string
  montant_ttc: number
  acompte: boolean
  facture_origine_id: string | null
}

/** Une ligne d'une facture d'acompte validée, telle que la base l'a figée. */
export interface LigneDAcompte {
  facture_id: string
  ordre: number
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
  nature: NatureArticle | null
}

/** Les acomptes des devis d'un dossier, LUS EN ENTIER : ce que les deux gestes jugent. */
export interface AcomptesLus {
  liens: LienDuDevis[]
  factures: FactureDuDevis[]
  // Les lignes des factures d'acompte validées du dossier.
  lignes: LigneDAcompte[]
  // Le modèle comptable LU du dossier (P5B-Q3).
  mode: ModeComptable
}

// ── L'état d'acompte d'un devis ────────────────────────────────────────────────────────────────────────────────────
export interface EtatAcomptesDuDevis {
  // Les acomptes EN VIGUEUR (`acomptes_en_vigueur`) : validés, qu'aucun avoir ne crédite, dans l'ordre de leurs dates, de
  // leurs numéros puis de leurs identifiants — celui où la finale les reprend.
  acomptesValides: AcompteValide[]
  // Un acompte en brouillon (P5B-Q2 : un seul à la fois), ou null.
  brouillon: { factureId: string } | null
  // La facture finale ACTIVE (`finale_active_du_devis`) : en brouillon, ou validée et pas créditée en entier — la première
  // par la date du lien puis son identifiant, comme `facturer_devis` la nomme ; null sinon (P5B-Q4).
  finaleActive: { factureId: string; numero: string | null } | null
}

const centimes = (euros: number) => Math.round(euros * 100)
// L'ordre `collate "C"` de la base : celui des unités de code, jamais celui de la langue.
const ordreC = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export type EtatAcomptesLu = { ok: true; etat: EtatAcomptesDuDevis } | { ok: false; motif: string }

/**
 * L'état d'acompte d'un devis, sur les acomptes lus en entier. Un lien dont la facture n'est pas lue, ou un acompte validé
 * dont aucune ligne n'est revenue, dit un manque : jamais « pas d'acompte ».
 */
export function etatDesAcomptes(devisId: string, lus: AcomptesLus): EtatAcomptesLu {
  const parId = new Map(lus.factures.map((f) => [f.id, f]))
  const liens = lus.liens.filter((l) => l.devis_id === devisId)
  if (liens.some((l) => !parId.has(l.facture_id))) return { ok: false, motif: 'une facture tirée de ce devis n’a pas été lue' }
  // Ce que les avoirs d'une facture en ont crédité, en centimes (ses montants sont négatifs).
  const credite = (factureId: string) => lus.factures
    .filter((a) => a.type === 'avoir' && a.facture_origine_id === factureId)
    .reduce((s, a) => s - centimes(a.montant_ttc), 0)
  const acomptes = liens.filter((l) => l.role === 'acompte').map((l) => parId.get(l.facture_id) as FactureDuDevis)
  const enVigueur = acomptes
    .filter((f) => f.acompte && f.statut === 'validee'
      && !lus.factures.some((a) => a.type === 'avoir' && a.facture_origine_id === f.id))
    .sort((a, b) => ordreC(a.date_emission, b.date_emission) || ordreC(a.numero ?? '', b.numero ?? '') || ordreC(a.id, b.id))
  const acomptesValides: AcompteValide[] = []
  for (const f of enVigueur) {
    const lignes = lus.lignes.filter((l) => l.facture_id === f.id).sort((a, b) => a.ordre - b.ordre)
    if (lignes.length === 0 || f.numero == null) {
      return { ok: false, motif: `les lignes de l’acompte ${f.numero ?? 'validé'} n’ont pas été lues` }
    }
    acomptesValides.push({
      id: f.id, numero: f.numero, date: f.date_emission,
      lignes: lignes.map((l) => ({ quantite: l.quantite, prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva, nature: l.nature })),
    })
  }
  const brouillon = acomptes.find((f) => f.statut !== 'validee')
  const finale = liens
    .filter((l) => l.role === 'finale')
    .sort((a, b) => ordreC(a.cree_le, b.cree_le) || ordreC(a.id, b.id))
    .map((l) => parId.get(l.facture_id) as FactureDuDevis)
    .find((f) => f.statut !== 'validee' || credite(f.id) < centimes(f.montant_ttc))
  return {
    ok: true,
    etat: {
      acomptesValides,
      brouillon: brouillon ? { factureId: brouillon.id } : null,
      finaleActive: finale ? { factureId: finale.id, numero: finale.numero } : null,
    },
  }
}

/** Ce que la colonne « Facture » de la liste dit d'un devis : ses acomptes, puis sa finale ; null s'il n'en a aucun. */
export function libelleDesFacturesDuDevis(devisId: string, lus: AcomptesLus, etat: EtatAcomptesDuDevis): string | null {
  const parId = new Map(lus.factures.map((f) => [f.id, f]))
  const acomptes = lus.liens.filter((l) => l.devis_id === devisId && l.role === 'acompte')
  const finale = etat.finaleActive ? (etat.finaleActive.numero ?? 'Brouillon de facture') : null
  if (acomptes.length === 0) return finale
  const parts = acomptes
    .map((l) => parId.get(l.facture_id))
    .filter((f): f is FactureDuDevis => f != null)
    .sort((a, b) => ordreC(a.date_emission, b.date_emission) || ordreC(a.numero ?? '', b.numero ?? '') || ordreC(a.id, b.id))
    .map((f) => {
      if (f.statut !== 'validee') return 'Acompte en brouillon'
      const credite = lus.factures.some((a) => a.type === 'avoir' && a.facture_origine_id === f.id)
      return `Acompte ${f.numero ?? ''}${credite ? ' (crédité)' : ''}`
    })
  return [...parts, ...(finale ? [`Finale ${finale}`] : [])].join(' ; ')
}

// ── Les refus ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Le refus de `facturer_acompte_devis` et de `facturer_devis` sur un devis hors du dossier, à leurs mots. */
export const REFUS_DEVIS_INTROUVABLE = 'Devis introuvable dans ce dossier.'

/**
 * Le refus de `facturer_devis` REMPLACÉE (la finale) quand un acompte du devis est en brouillon, à ses mots : il vient
 * après ceux d'hier (`REFUS_FACTURATION_DEVIS`, lib/devis.ts), dont « a déjà sa facture » ne vise plus qu'une finale ACTIVE.
 */
export const REFUS_SOLDE_ACOMPTE_EN_BROUILLON =
  'Un acompte de ce devis est encore en brouillon : validez-le ou supprimez-le avant d’en tirer la facture finale.'

// P5B3-Q1 (B), SUR LA RECOMMANDATION : un acompte de BIENS n'est pas une livraison — sa TVA est exigible à son
// encaissement, sa part impayée à la livraison de la finale qui le reprend (CGI, art. 269, 2-a ; lib/ventesFacturees.ts) —,
// et les écritures que la base recompose (`ecrire_vente_facturee`, `valider_exercice`) ne connaissent pas encore la marque
// d'acompte. Tant que la base ne l'apprend pas (une migration à part), l'acompte se refuse ICI, avant le clic, sur un devis
// qui porte des livraisons de biens (`nature_operation` « biens » ou « mixte » : les lignes d'un devis ne disent pas leur
// nature). La base, elle, ne le refuse pas encore : ce refus est un refus de l'ÉCRAN, plus strict que la base, et
// acomptesDuDevis.test.ts vérifie que la migration préparée ne le porte pas.
export const REFUS_ACOMPTE_DE_BIENS =
  'Le devis porte des livraisons de biens : l’acompte d’un tel devis ne se facture pas encore ici, la TVA d’un acompte de '
  + 'biens étant due à son encaissement et sa part impayée à la livraison, ce que les écritures ne savent pas encore tenir. '
  + 'Le devis se facture en entier par sa facture finale.'

/** Les bornes que le générateur CII admet pour une date (`factureCii.ts`, BT-9) : une date hors d'elles ne se transmettrait pas. */
const ANNEE_MIN = 2000
const ANNEE_MAX = 2099

export const REFUS_VERSEMENT_ILLISIBLE = 'La date du versement n’est pas une date (années 2000 à 2099).'

/** P5B2-Q1 : la date du versement n'est jamais postérieure au jour de Paris. */
export function refusDuVersementFutur(aujourdHui: string): string {
  return `Le versement ne se date pas dans l’avenir : nous sommes le ${formatDate(aujourdHui)}.`
}

/** La date du versement saisie : vide (facultative), sinon une date admise et pas à venir. Le premier refus, ou null. */
export function refusDeLaDateDuVersement(saisie: string, aujourdHui: string): string | null {
  if (saisie.trim() === '') return null
  const date = dateDeLaBase(saisie.trim())
  if (date == null) return REFUS_VERSEMENT_ILLISIBLE
  const annee = Number(date.slice(0, 4))
  if (annee < ANNEE_MIN || annee > ANNEE_MAX) return REFUS_VERSEMENT_ILLISIBLE
  if (date > aujourdHui) return refusDuVersementFutur(aujourdHui)
  return null
}

/** Un devis porte-t-il des livraisons de biens (P5B3-Q1) ? */
export function devisDeBiens(d: Pick<Devis, 'nature_operation'>): boolean {
  return d.nature_operation === 'biens' || d.nature_operation === 'mixte'
}

// ── La saisie de la fenêtre de l'acompte ───────────────────────────────────────────────────────────────────────────
/** Ce que la fenêtre tient : le mode, le montant en TEXTE (la virgule admise), la date du versement (vide : aucune). */
export interface SaisieAcompte {
  mode: 'pourcentage' | 'ttc'
  montant: string
  dateVersement: string
}

const FORME_DECIMAL = /^([0-9]+)(?:[.,]([0-9]+))?$/

/**
 * La demande telle qu'elle part (`p_demande`, la `DemandeAcompte` du module). Un texte qui n'est pas un nombre part en NaN,
 * que `refusDeLaDemande` dit hors des bornes ou non positif — jamais zéro. Un TTC se lit en centimes sur son ÉCRITURE : un
 * millième non nul le rend non entier, et « au centime près » le dit.
 */
export function demandeDeLaSaisie(s: SaisieAcompte): DemandeAcompte {
  const m = FORME_DECIMAL.exec(s.montant.trim())
  if (s.mode === 'pourcentage') return { mode: 'pourcentage', pourcentage: m ? Number(`${m[1]}.${m[2] ?? '0'}`) : Number.NaN }
  if (!m) return { mode: 'ttc', ttcCentimes: Number.NaN }
  const fraction = m[2] ?? ''
  const exces = /[1-9]/.test(fraction.slice(2)) ? 0.5 : 0
  return { mode: 'ttc', ttcCentimes: Number(m[1]) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0')) + exces }
}

/** Ce que la fenêtre juge : le devis tel que la liste l'a lu, son état d'acompte, le modèle comptable du dossier. */
export interface EntreeDeLAcompte {
  dossierId: string
  devis: Pick<Devis, 'id' | 'dossier_id' | 'statut' | 'reponse' | 'numero' | 'lignes' | 'nature_operation'>
  etat: EtatAcomptesDuDevis
  mode: ModeComptable
  saisie: SaisieAcompte
  aujourdHui: string
}

export type AcompteJuge =
  | { ok: true; prepare: Extract<AcomptePrepare, { ok: true }>; demande: DemandeAcompte; dateVersement: string | null }
  | { ok: false; refus: string }

/**
 * L'acompte, ou le premier refus : celui de la base (introuvable, puis l'état du devis et du dossier, dans l'ordre de
 * `facturer_acompte_devis`), puis celui du devis de biens (P5B3-Q1, l'écran seul), puis la saisie et ce qu'elle demande au
 * reste du devis (`preparerAcompte`, aux mots de la base), puis la date du versement (P5B2-Q1, l'écran seul).
 */
export function jugerLAcompte(e: EntreeDeLAcompte): AcompteJuge {
  const d = e.devis
  if (d.dossier_id !== e.dossierId) return { ok: false, refus: REFUS_DEVIS_INTROUVABLE }
  const demande = demandeDeLaSaisie(e.saisie)
  const r = preparerAcompte({
    numeroDevis: d.numero ?? '',
    lignesDevis: d.lignes,
    acomptesValides: e.etat.acomptesValides,
    demande,
    etat: {
      accepte: d.statut === 'emis' && d.reponse === 'acceptee',
      finaleActive: e.etat.finaleActive != null,
      acompteEnBrouillon: e.etat.brouillon != null,
      mode: e.mode,
    },
  })
  const refusDeLEtat: readonly string[] = [
    REFUS_ACOMPTE.nonAccepte, REFUS_ACOMPTE.finaleActive, REFUS_ACOMPTE.acompteEnBrouillon, REFUS_ACOMPTE.engagement,
  ]
  if (!r.ok && refusDeLEtat.includes(r.refus)) return r
  if (devisDeBiens(d)) return { ok: false, refus: REFUS_ACOMPTE_DE_BIENS }
  if (!r.ok) return r
  const refusDate = refusDeLaDateDuVersement(e.saisie.dateVersement, e.aujourdHui)
  if (refusDate) return { ok: false, refus: refusDate }
  const date = e.saisie.dateVersement.trim()
  return { ok: true, prepare: r, demande, dateVersement: date === '' ? null : date }
}

const nomDuDevis = (d: Pick<Devis, 'numero' | 'tiers_nom' | 'montant_ttc'>) =>
  `devis ${d.numero ?? ''} pour « ${nomDansUnRefus(d.tiers_nom)} » (${formatMoney(d.montant_ttc)} TTC)`

const lesLignes = (n: number) => (n === 1 ? 'une ligne' : `${n} lignes, une par taux de TVA`)

/** Ce que la fenêtre dit de l'acompte avant le clic : le TTC exact, ses montants, et l'écart à un TTC demandé. */
export function resumeDeLAcompte(j: Extract<AcompteJuge, { ok: true }>): string {
  const t = j.prepare.totaux
  const exact = `${formatMoney(t.montant_ttc)} TTC exactement (${formatMoney(t.montant_ht)} HT, ${formatMoney(t.montant_tva)} de TVA)`
  const ecart = j.demande.mode === 'ttc' && j.demande.ttcCentimes !== j.prepare.ttc
    ? ` — ${formatMoney(j.demande.ttcCentimes / 100)} TTC demandés ne se répartissent pas exactement sur les taux du devis : `
      + 'le plus proche est retenu'
    : ''
  return `L’acompte fera ${exact}${ecart}, en ${lesLignes(j.prepare.lignes.length)}.`
}

/**
 * La confirmation de l'acompte : elle nomme le devis, son client, ce qui est demandé, le TTC exact, la date du versement si
 * elle est donnée — et ce qui ne se défera plus que par la suppression du brouillon.
 */
export function confirmationDeLAcompte(
  d: Pick<Devis, 'numero' | 'tiers_nom' | 'montant_ttc'>,
  j: Extract<AcompteJuge, { ok: true }>,
  aujourdHui: string,
): string {
  const quoi = j.demande.mode === 'pourcentage'
    ? `${String(j.demande.pourcentage).replace('.', ',')} % du devis`
    : `${formatMoney(j.demande.ttcCentimes / 100)} TTC demandés`
  const versement = j.dateVersement == null ? ''
    : j.dateVersement === aujourdHui
      ? ' Le versement est daté du jour de la facture : la facture ne le redit pas.'
      : ` La facture dira l’acompte versé le ${formatDate(j.dateVersement)}.`
  return `Facturer un acompte (${quoi}) sur le ${nomDuDevis(d)} ? Un BROUILLON de facture d’acompte sera créé, daté du `
    + `${formatDate(aujourdHui)}, de ${formatMoney(j.prepare.totaux.montant_ttc)} TTC exactement `
    + `(${formatMoney(j.prepare.totaux.montant_ht)} HT), en ${lesLignes(j.prepare.lignes.length)}.${versement} Ses lignes se `
    + 'calculent du devis et ne se retouchent pas : le brouillon se valide comme toute facture, ou se supprime pour en tirer '
    + 'un autre. La facture finale du devis le reprendra en déduction.'
}

// ── Le solde : la facture finale ───────────────────────────────────────────────────────────────────────────────────
/**
 * Ce que `facturer_devis` remplacée refuserait, dans son ordre et sous ses mots — ceux d'hier (« a déjà sa facture » ne
 * visant que la finale ACTIVE), puis l'acompte en brouillon —, puis ce que la validation de la finale refuserait
 * (`refusDeLaFinale` : des acomptes repris au-delà du devis, venus d'ailleurs) : l'écran ne tire pas un brouillon qui ne
 * se validerait pas. Null quand la finale se tirerait.
 */
export function refusDuSolde(
  dossierId: string,
  d: Pick<Devis, 'dossier_id' | 'statut' | 'numero' | 'reponse' | 'lignes'>,
  etat: EtatAcomptesDuDevis,
): string | null {
  const hier = refusFacturationDevis(dossierId, d, etat.finaleActive ? { numero: etat.finaleActive.numero } : null)
  if (hier) return hier.message
  if (etat.brouillon) return REFUS_SOLDE_ACOMPTE_EN_BROUILLON
  return refusDeLaFinale(lignesDeLaFinale(d.lignes, etat.acomptesValides))
}

/** Les lignes et les totaux de la finale qui se tirerait : le devis, moins chaque acompte en vigueur. */
export function finaleDuDevis(d: Pick<Devis, 'lignes'>, etat: EtatAcomptesDuDevis): { lignes: LigneTiree[]; ttc: number } {
  const lignes = lignesDeLaFinale(d.lignes, etat.acomptesValides)
  return { lignes, ttc: calculerTotaux(lignes).montant_ttc }
}

/**
 * La confirmation du solde : elle nomme le devis, son client, les acomptes repris (leurs numéros, dates et TTC) et le net
 * à payer — ou dit qu'aucun acompte n'est à reprendre —, et ce que le brouillon reprend du devis.
 */
export function confirmationDuSolde(
  d: Pick<Devis, 'numero' | 'tiers_nom' | 'montant_ttc' | 'lignes'>,
  etat: EtatAcomptesDuDevis,
  aujourdHui: string,
): string {
  const { ttc } = finaleDuDevis(d, etat)
  const n = d.lignes.length
  const reprises = etat.acomptesValides.length === 0
    ? ' Aucun acompte n’est à reprendre : elle porte le devis entier.'
    : ` En déduction, ${etat.acomptesValides.length === 1 ? 'l’acompte' : 'les acomptes'} `
      + etat.acomptesValides
        .map((a) => `${a.numero} du ${formatDate(a.date)} (${formatMoney(calculerTotaux(a.lignes.map((l) => ({ ...l }))).montant_ttc)} TTC)`)
        .join(', ')
      + `, ${etat.acomptesValides.length === 1 ? 'repris' : 'repris chacun'} au signe opposé : net à payer ${formatMoney(ttc)} TTC.`
  return `Facturer le solde du ${nomDuDevis(d)} ? Un BROUILLON de facture finale sera créé, daté du ${formatDate(aujourdHui)}, `
    + `reprenant le client et ses mentions, ${n === 1 ? 'la ligne' : `les ${n} lignes`} du devis, à l’émetteur du jour.${reprises} `
    + 'Le devis sera marqué facturé ; le brouillon se relit, se complète et se valide comme toute facture.'
}
