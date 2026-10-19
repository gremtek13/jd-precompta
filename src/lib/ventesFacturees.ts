import { montantsDuDocument } from './factureCii'
import { centimesExacts, type LigneDeFacture } from './encaissementsFactures'
import type { EncaissementFacture, EncaissementFactureTaux, FactureEmise, ModeComptable, Piece } from './types'

// LES VENTES FACTURÉES, TELLES QUE LES MOTEURS LES COMPTERONT (ligne 28.6, chantier EC-Q3, étape VF3a ; décision du cabinet
// du 18/10/2026 ; conception : HISTORIQUE.md, « LA FACTURE VALIDÉE, SOURCE DE SA VENTE : LA CONCEPTION », § 3 à 6, 8, 9, 14
// et 18). Un module PUR — il ne lit rien en base, n'appelle personne, ne lit pas l'horloge — qui part des factures validées
// SOURCES d'un dossier, de leurs lignes, de leurs avoirs validés et du registre des encaissements, et rend ce qu'une vente
// facturée pèse dans la 2035, la CA3 et les états qui les déclinent. RIEN NE LE LIT ENCORE : l'étape VF3b branchera la
// 2035, la CA3, la situation, l'estimation et la simulation, puis leurs écrans. Sa lecture est dans
// lib/ventesFactureesLecture.ts.
//
// ── LA DÉCISION DE FORME (le premier point de la relecture, § 18) ─────────────────────────────────────────────────────────
//
// lib/partsDuReleve.ts dit « LES MOTEURS NE LISENT QUE CETTE FORME » et « une source s'ajoute ICI » : la forme commune
// existe pour qu'une source nouvelle ne soit pas un paramètre de plus à quatre moteurs et sept écrans, qu'un appelant
// oublierait en silence. Deux voies se présentaient : élargir `PartDuReleve` (une part d'origine « encaissement », sans
// mouvement obligatoire), ou garder une SECONDE forme. CE MODULE GARDE UNE SECONDE FORME, `VentesFacturees`, que chaque
// moteur recevra en paramètre OBLIGATOIRE, sans valeur par défaut. Quatre raisons, chacune une différence de nature et non
// de détail entre une part du relevé et une vente facturée :
//   1. LA CA3 NE LIT PAS LES MÊMES ÉVÉNEMENTS QUE LA 2035. Une part du relevé est à la fois une recette de la 2035 et une
//      opération de la CA3, à la même date. Une vente facturée non : pour des biens, la TVA est exigible à la LIVRAISON
//      (CGI, art. 269, 1-a et 2-a ; BOI-TVA-BASE-20-10, § 1, 10, 65) et sur l'option pour les débits à la date de la
//      FACTURE (art. 269, 2-c ; BOI-TVA-BASE-20-20, § 30 ; un acompte perçu avant, à sa perception) — des événements qui ne sont pas des recettes et qu'aucun
//      encaissement ne porte (le reste à encaisser d'un bien livré est taxable sans avoir été reçu) ; et, à l'inverse, un
//      encaissement d'un bien livré est une recette de la 2035 sans rien changer à la CA3. Élargie, la forme commune
//      porterait des parts que la 2035, la situation, l'estimation et la simulation devraient TOUTES savoir écarter : un
//      lecteur qui l'oublierait compterait de la TVA exigible comme une recette, en silence — la panne même que la forme
//      commune devait empêcher, retournée.
//   2. LA TVA NE SE RECALCULE PAS DU TTC. La CA3 refait la TVA d'une part du relevé depuis son montant et son taux
//      (`horsTaxeEtTva`) ; celle d'une vente facturée suit la RÈGLE DU CUMUL (§ 6 : un taux soldé porte exactement la TVA
//      facturée, art. 283, 3 ; BOI-TVA-DECLA-30-20-20-30, § 350) : recalculée par part, elle s'écarterait d'un centime de
//      la facture à chaque paiement partiel. La part doit donc PORTER sa TVA, et le lecteur ne plus la recalculer.
//   3. UNE DATE SANS MOUVEMENT. Une part du relevé n'existe que par son mouvement (`ligne`), dont tous les lecteurs lisent
//      la date et l'identifiant ; un encaissement en espèces, par compensation, ou saisi par un client sans « Banque » n'en
//      cite aucun, et sa date est celle du registre (la remise d'un chèque, non son crédit : CGI, art. 93, 1 ;
//      BOI-BNC-BASE-20-10-10, § 20). `ligne` deviendrait facultative pour vingt lignes de sept fichiers.
//   4. UNE PART PAR TAUX. Le registre répartit chaque encaissement par taux (G7.45) : une vente facturée à deux taux en
//      fait deux parts, que la CA3 place sur deux lignes ; une part du relevé n'a qu'un taux, celui de sa catégorie.
// Ce que l'élargissement aurait coûté à VF3b, mesuré sur `76a5e6b` : les vingt lignes qui lisent le mouvement d'une part
// (sa date, son identifiant, son libellé, son montant) — declaration2035.ts (3), declarationTva.ts (1),
// situationIntermediaire.ts (1), estimation.ts (2), revueAnalytique.ts (4), ClotureTab.tsx (4), TvaTab.tsx (5) —, rendues
// nullables ; un champ de TVA porté et lu au lieu de `horsTaxeEtTva` ; le refus `sur_debits` de la CA3 défait pour cette seule origine ; et, dans les cinq moteurs qui ne sont
// pas la CA3, un filtre qui écarte les parts d'exigibilité. La seconde forme coûte un paramètre par moteur et une boucle :
// AUCUN lecteur de `PartDuReleve` ne change, et les sept appels de `partsDuReleve` restent tels quels. Les écrans qui
// lisent les sources (Clôture, TVA, Financement, Estimation, Révision, la simulation du client) sont les mêmes dans les
// deux voies : chacun devra lire les ventes facturées et les passer.
//
// ── CE QUE LE MODULE REND ─────────────────────────────────────────────────────────────────────────────────────────────────
//
//   - `parts` : par encaissement et par taux — p, le TTC de la part (le registre) ; v, sa TVA par la règle du cumul ;
//     h = p − v — à la DATE DE L'ENCAISSEMENT, celle de la 2035 en trésorerie (art. 93, 1) ; les contre-passations en
//     parts opposées, à leur date ; un encaissement retiré ne compte pas. HT OU TTC : LA FACTURE LE DIT ELLE-MÊME (§ 5) —
//     la recette est h, sa TVA va au 44571 quel que soit le statut du dossier aujourd'hui (`montantRetenu`, qui suit le
//     droit à déduction d'un achat, ne s'applique pas) ; une franchise ou une exonération, ce sont des lignes à 0 % : v est
//     nulle et la recette est le TTC.
//   - `exigibilites` : ce que la CA3 compte, par taux, à sa date (§ 6, corrigé à la relecture de VF3a) — pour des
//     services, chaque part à la date de son encaissement ; pour des biens à la livraison (`date_prestation`, sinon la date
//     d'émission : art. 289, I), et pour des services sur l'option pour les débits à la date de la facture, MAIS un
//     encaissement antérieur, comme un acompte, à sa propre date (art. 269, 2-a et 2-c ; BOI-TVA-BASE-20-40 ; directive
//     2006/112/CE, art. 65) : l'option ne retarde pas l'exigibilité au-delà d'une perception ; le reste de la facture à
//     son fait générateur, un avoir d'après à sa date ; rien d'un encaissement daté de ce fait générateur ou d'après.
//     Signée : une exigibilité négative est une régularisation (B5 et 21 ; F8 à 0 %).
//   - `documents` : la facture et ses avoirs, par taux, à leur date d'émission — ce qu'un état en ENGAGEMENT compte (§ 5 ;
//     la date fine du produit est EC3-Q12).
//   - `ecartees` : une facture source qu'on ne sait pas compter sans deviner, et pourquoi — rien n'en est compté, et le
//     moteur qui la reçoit doit la dire, comme une pièce écartée ;
//   - `excedents` : un taux encaissé au-delà de ce que la facture porte, nette d'un avoir émis après le paiement — compté,
//     et à dire (le trop-perçu est hors du chantier, EC3-Q10).
//   - `sources` et `exemplaireDUneFactureSource` : l'exemplaire désigné d'une facture source (`pieces.facture_id`, étape
//     VF1) ne compte plus (§ 8) — un prédicat que les moteurs de VF3b liront pour ne pas compter deux fois la même vente.
//
// LE RÉGIME DE LA FACTURE SE LIT LÀ OÙ LA BASE LE FIGE, jamais au dossier d'aujourd'hui : `nature_operation` (une facture
// source dit « biens » ou « services », sinon elle ne se valide pas — `fixer_source_de_la_vente`) et `option_debits`, que
// `enregistrer_facture` fige à la validation comme le dossier la portait ce jour-là (`tva_sur_debits` d'un dossier
// redevable ; un avoir prend celle de sa facture). L'option ne vaut que pour des SERVICES : la TVA d'un bien est exigible à
// sa livraison, option ou non (art. 269, 2-a et 2-c). Une valeur que la base aurait dû poser et qui manque écarte la
// facture : on ne devine pas un régime.
//
// LA RÈGLE DU CUMUL (§ 6), en centimes entiers : pour un taux, V et T la TVA et le TTC de la facture, nets de ses avoirs
// validés datés au plus tard du jour de l'encaissement ; P le cumul net de ses encaissements à ce jour, celui-ci compris ;
// la TVA cumulée vaut V × P / T arrondi au centime (le demi s'éloigne de zéro), et l'encaissement prend la différence avec
// la TVA que les précédents ont portée. Un taux soldé (P = T) porte donc exactement V : « le cumul s'arrondit, pas
// l'annuité », la règle des dotations. Une CONTRE-PASSATION porte exactement l'opposé de l'encaissement qu'elle annule —
// la taxe de l'impayé est celle qui a été déclarée (BOI-TVA-BASE-20-20, § 40) — et l'encaissement suivant reprend la
// différence. Les encaissements d'un jour se rangent par leur création, puis leur identifiant octet par octet (l'ordre de
// la garde des mouvements, G2) : la somme d'un jour n'en dépend pas, la part de chacun si. La base refera ce calcul en
// entiers à l'étape VF4, confronté à une table relevée en base. LA RÈGLE DU CUMUL ET SON ARRONDI vont à l'expert-comptable
// du cabinet (EC3-Q7, § 18).

// ── Ce que le module lit ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Une facture émise telle que ce module la lit : sa source, son régime figé, et la facture que corrige un avoir. */
export type FactureVendue = Pick<FactureEmise,
  'id' | 'dossier_id' | 'statut' | 'type' | 'numero' | 'date_emission' | 'tiers_nom' | 'facture_origine_id'
  | 'source_de_la_vente' | 'nature_operation' | 'option_debits' | 'date_prestation'>

/** Un encaissement du registre, retirés et contre-passations compris : c'est ici qu'ils comptent, ou non. */
export type EncaissementVendu = Pick<EncaissementFacture,
  'id' | 'dossier_id' | 'facture_id' | 'date_encaissement' | 'montant' | 'moyen' | 'ligne_bancaire_id' | 'annule_id'
  | 'cree_le' | 'retire_le'>

/** La part d'un encaissement à un taux, du signe de son encaissement. */
export type PartVendue = Pick<EncaissementFactureTaux, 'encaissement_id' | 'dossier_id' | 'taux' | 'montant'>

/**
 * Ce que la lecture a rendu, EN ENTIER (lib/ventesFactureesLecture.ts). Les listes peuvent porter plus que les factures
 * sources du dossier : le module filtre lui-même, sur le dossier et sur la source, comme la base — un filtre oublié par
 * l'appelant ferait compter une facture d'un autre dossier, ou une facture d'avant la bascule, que sa pièce compte déjà.
 */
export interface SourcesVentesFacturees {
  dossierId: string
  factures: readonly FactureVendue[]
  lignes: readonly LigneDeFacture[]
  encaissements: readonly EncaissementVendu[]
  parts: readonly PartVendue[]
}

// ── Ce que le module rend ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Le régime d'exigibilité d'une facture source (§ 6). */
export type RegimeCa3 = 'encaissement' | 'livraison' | 'debits'

/** Une facture, telle qu'une part, une exigibilité ou un écart la nomme. */
export interface FactureNommee {
  factureId: string
  numero: string | null
  tiers: string
}

/** Une part d'un encaissement à un taux : la recette de la 2035, à la date de l'encaissement. Centimes signés. */
export interface PartVenteFacturee extends FactureNommee {
  encaissementId: string
  /** L'encaissement qu'elle annule, pour une contre-passation ; nul pour un encaissement. */
  annuleId: string | null
  /** La date de l'encaissement : celle de la 2035 et de la trésorerie. */
  date: string
  moyen: EncaissementFacture['moyen']
  /** Le mouvement qu'il cite, quand il en cite un — jamais nécessaire pour compter. */
  ligneBancaireId: string | null
  taux: number
  regime: RegimeCa3
  /** p : le TTC de la part, tel que le registre le porte. */
  ttcCentimes: number
  /** v : sa TVA, par la règle du cumul. */
  tvaCentimes: number
  /** h = p − v : la recette. */
  htCentimes: number
}

/**
 * Une opération que la CA3 compte, à sa date d'exigibilité, à un taux. `origine` : un encaissement (services ; un bien
 * encaissé avant sa livraison ; des services sur les débits encaissés avant la date de leur facture), la livraison d'un
 * bien ou la facture sur l'option pour les débits (ce qui reste de la facture, nette de ses avoirs, une fois ôté ce que les
 * encaissements antérieurs ont rendu exigible), ou un avoir daté après l'une ou l'autre. Signée : négative, c'est une
 * régularisation.
 */
export interface ExigibiliteVenteFacturee extends FactureNommee {
  origine: 'encaissement' | 'livraison' | 'facture' | 'avoir'
  /** L'encaissement ou la contre-passation, pour l'origine « encaissement » ; nul sinon. */
  encaissementId: string | null
  /** L'avoir, pour l'origine « avoir » ; nul sinon. */
  avoirId: string | null
  date: string
  taux: number
  baseCentimes: number
  tvaCentimes: number
}

/** La facture ou l'un de ses avoirs, à un taux, à sa date d'émission : ce qu'un état en engagement compte. Signé. */
export interface DocumentVenteFacturee extends FactureNommee {
  /** La facture, ou l'avoir (`avoirId`). */
  avoirId: string | null
  date: string
  taux: number
  baseCentimes: number
  tvaCentimes: number
  ttcCentimes: number
}

export type MotifVenteEcartee =
  | 'nature' | 'option_debits' | 'sans_lignes' | 'encaissement_illisible' | 'contre_passation_illisible' | 'ttc_nul'

export const LIBELLE_MOTIF_VENTE: Record<MotifVenteEcartee, string> = {
  nature: 'la facture ne dit pas si elle porte sur des biens ou sur des services : on ne sait ni quand sa TVA est due, ni où la compter',
  option_debits: "la facture ne porte pas l'option pour les débits que sa validation fige : on ne sait pas quand sa TVA est due",
  sans_lignes: "la facture n'a aucune ligne : son TTC par taux est inconnu",
  encaissement_illisible: "un encaissement ne se répartit pas sur les taux de la facture, au centime, pour son montant : la règle du cumul ne s'y applique pas",
  contre_passation_illisible: "une contre-passation n'est pas l'exact opposé d'un encaissement compté avant elle",
  ttc_nul: "ses avoirs datés au plus tard du jour d'un encaissement annulent le taux de cet encaissement : la règle du cumul n'a plus de TTC à répartir",
}

/**
 * Un taux dont les encaissements dépassent, à la fin, ce que la facture porte nette de ses avoirs : un avoir émis après
 * un paiement, que rien n'a encore remboursé (le trop-perçu, hors du chantier ; EC3-Q10). La base plafonne chaque
 * encaissement net des avoirs DÉJÀ validés ; un avoir validé ensuite peut faire passer le registre au-dessus. Rien n'est
 * écarté — l'argent a été reçu, la 2035 le compte, et sa TVA suit la règle du cumul — mais le moteur doit le DIRE.
 */
export interface ExcedentVenteFacturee extends FactureNommee {
  taux: number
  /** Ce qui est encaissé au-delà du TTC net, en centimes, positif. */
  excedentCentimes: number
}

/** Une facture source que le module n'a pas comptée, et pourquoi. Rien d'elle n'est compté nulle part. */
export interface VenteEcartee extends FactureNommee {
  motif: MotifVenteEcartee
  detail: string
}

export interface VentesFacturees {
  /** Le dossier pour lequel elles ont été calculées. */
  dossierId: string
  parts: PartVenteFacturee[]
  exigibilites: ExigibiliteVenteFacturee[]
  documents: DocumentVenteFacturee[]
  ecartees: VenteEcartee[]
  excedents: ExcedentVenteFacturee[]
  /** Les factures et avoirs validés SOURCES du dossier — écartés compris : leur exemplaire ne compte pas non plus. */
  sources: ReadonlySet<string>
}

// ── Les calculs ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * V × P / T arrondi au centime, le demi loin de zéro, en entiers longs : un TTC de dix mille milliards d'euros, en
 * centimes, multiplié par une TVA de même ordre, ne tient pas dans un nombre à virgule flottante. `t` est positif.
 */
export function prorataArrondi(v: number, p: number, t: number): number {
  const num = BigInt(v) * BigInt(p)
  const den = BigInt(t)
  const absolu = num < 0n ? -num : num
  const q = (2n * absolu + den) / (2n * den)
  return Number(num < 0n ? -q : q)
}

interface MontantsDuTaux {
  base: number
  tva: number
}

// Les montants d'un document par taux, dans le sens du document (un avoir en positif) : le calcul de la facture
// électronique transmise, que la base refait (`montants_par_taux_facture`).
function parTaux(document: FactureVendue, lignes: readonly LigneDeFacture[]): Map<number, MontantsDuTaux> {
  const m = new Map<number, MontantsDuTaux>()
  for (const g of montantsDuDocument(document, lignes.filter((l) => l.facture_id === document.id), null).groupes) {
    const actuel = m.get(g.taux) ?? { base: 0, tva: 0 }
    m.set(g.taux, { base: actuel.base + g.baseCentimes, tva: actuel.tva + g.tvaCentimes })
  }
  return m
}

/** Le régime d'exigibilité d'une facture source, lu sur ce qu'elle a figé ; le motif de l'écart quand elle ne le dit pas. */
export function regimeDeLaFacture(facture: Pick<FactureVendue, 'nature_operation' | 'option_debits'>): RegimeCa3 | MotifVenteEcartee {
  if (facture.nature_operation === 'biens') return 'livraison'
  if (facture.nature_operation !== 'services') return 'nature'
  if (facture.option_debits == null) return 'option_debits'
  return facture.option_debits ? 'debits' : 'encaissement'
}

/** La date de livraison d'un bien (§ 6) : celle de la prestation que porte la facture, sinon sa date d'émission. */
export function dateDeLivraison(facture: Pick<FactureVendue, 'date_prestation' | 'date_emission'>): string {
  return facture.date_prestation ?? facture.date_emission
}

// Octet par octet, comme la base sous `collate "C"` ou sur un identifiant : jamais `localeCompare`.
function ordreC(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** L'ordre des encaissements d'une facture : leur date, puis leur création, puis leur identifiant. */
export function ordreDesEncaissements(a: EncaissementVendu, b: EncaissementVendu): number {
  return ordreC(a.date_encaissement, b.date_encaissement) || ordreC(a.cree_le, b.cree_le) || ordreC(a.id, b.id)
}

type Resultat =
  | { ecart: { motif: MotifVenteEcartee; detail: string } }
  | {
    parts: PartVenteFacturee[]; exigibilites: ExigibiliteVenteFacturee[]; documents: DocumentVenteFacturee[]
    excedents: ExcedentVenteFacturee[]
  }

function ecart(motif: MotifVenteEcartee, precision?: string): Resultat {
  return { ecart: { motif, detail: precision ? `${LIBELLE_MOTIF_VENTE[motif]} (${precision})` : LIBELLE_MOTIF_VENTE[motif] } }
}

function uneFacture(
  facture: FactureVendue, avoirs: readonly FactureVendue[], lignes: readonly LigneDeFacture[],
  encaissements: readonly EncaissementVendu[], partsLues: readonly PartVendue[],
): Resultat {
  const regime = regimeDeLaFacture(facture)
  if (regime !== 'livraison' && regime !== 'debits' && regime !== 'encaissement') return ecart(regime)
  const nommee: FactureNommee = { factureId: facture.id, numero: facture.numero, tiers: facture.tiers_nom }

  const montantsFacture = parTaux(facture, lignes)
  if (montantsFacture.size === 0) return ecart('sans_lignes')
  const avoirsLus = [...avoirs]
    .sort((a, b) => ordreC(a.date_emission, b.date_emission) || ordreC(a.id, b.id))
    .map((a) => ({ avoir: a, montants: parTaux(a, lignes) }))

  // V et T d'un taux, nets des avoirs datés au plus tard de `date`.
  const netAu = (taux: number, date: string) => {
    const f = montantsFacture.get(taux) ?? { base: 0, tva: 0 }
    let base = f.base
    let tva = f.tva
    for (const { avoir, montants } of avoirsLus) {
      if (avoir.date_emission > date) continue
      const a = montants.get(taux)
      if (a) {
        base -= a.base
        tva -= a.tva
      }
    }
    return { V: tva, T: base + tva }
  }

  // Les encaissements qui comptent, dans leur ordre, chacun avec ses parts lues.
  const comptes = encaissements.filter((e) => e.retire_le == null).sort(ordreDesEncaissements)
  const partsParEncaissement = new Map<string, Map<number, number>>()
  for (const e of comptes) {
    const montant = centimesExacts(e.montant)
    const siennes = partsLues.filter((p) => p.encaissement_id === e.id)
    const parTauxDeE = new Map<number, number>()
    let somme = 0
    for (const p of siennes) {
      const c = centimesExacts(p.montant)
      // Une part nulle a le signe zéro : elle tombe avec une part de signe contraire.
      if (c == null || Math.sign(c) !== Math.sign(montant ?? 0) || parTauxDeE.has(p.taux) || !montantsFacture.has(p.taux)) {
        return ecart('encaissement_illisible', `encaissement du ${e.date_encaissement}`)
      }
      parTauxDeE.set(p.taux, c)
      somme += c
    }
    if (montant == null || montant === 0 || somme !== montant) return ecart('encaissement_illisible', `encaissement du ${e.date_encaissement}`)
    partsParEncaissement.set(e.id, parTauxDeE)
  }

  // La règle du cumul, taux par taux, dans l'ordre des encaissements.
  const parts: PartVenteFacturee[] = []
  const tvaPortee = new Map<number, number>()
  const encaisse = new Map<number, number>()
  const tvaDe = new Map<string, Map<number, number>>()
  for (const e of comptes) {
    const sesParts = partsParEncaissement.get(e.id)!
    const original = e.annule_id == null ? null : partsParEncaissement.get(e.annule_id)
    const tvaOriginale = e.annule_id == null ? null : tvaDe.get(e.annule_id)
    if (e.annule_id != null) {
      // Une contre-passation : l'exact opposé d'un encaissement compté AVANT elle, taux par taux.
      if (!original || !tvaOriginale || original.size !== sesParts.size
        || [...sesParts].some(([taux, p]) => original.get(taux) !== -p)) {
        return ecart('contre_passation_illisible', `contre-passation du ${e.date_encaissement}`)
      }
    }
    const tvaDeE = new Map<number, number>()
    for (const [taux, p] of [...sesParts].sort((a, b) => b[0] - a[0])) {
      const P = (encaisse.get(taux) ?? 0) + p
      const deja = tvaPortee.get(taux) ?? 0
      let v: number
      if (tvaOriginale) {
        v = -tvaOriginale.get(taux)!
      } else {
        const { V, T } = netAu(taux, e.date_encaissement)
        if (T <= 0) return ecart('ttc_nul', `à ${taux} %, encaissement du ${e.date_encaissement}`)
        v = prorataArrondi(V, P, T) - deja
      }
      encaisse.set(taux, P)
      tvaPortee.set(taux, deja + v)
      tvaDeE.set(taux, v)
      parts.push({
        ...nommee, encaissementId: e.id, annuleId: e.annule_id, date: e.date_encaissement, moyen: e.moyen,
        ligneBancaireId: e.ligne_bancaire_id, taux, regime, ttcCentimes: p, tvaCentimes: v, htCentimes: p - v,
      })
    }
    tvaDe.set(e.id, tvaDeE)
  }

  // Ce qui reste encaissé au-delà du TTC net, une fois tout compté.
  const excedents: ExcedentVenteFacturee[] = []
  for (const [taux, P] of [...encaisse].sort((a, b) => b[0] - a[0])) {
    const { T } = netAu(taux, '9999-12-31')
    if (P > T) excedents.push({ ...nommee, taux, excedentCentimes: P - T })
  }

  // Les documents, à leur date d'émission : la facture, puis ses avoirs, en négatif.
  const documents: DocumentVenteFacturee[] = []
  const pousserDocument = (date: string, avoirId: string | null, montants: Map<number, MontantsDuTaux>, signe: 1 | -1) => {
    for (const [taux, m] of [...montants].sort((a, b) => b[0] - a[0])) {
      documents.push({
        ...nommee, avoirId, date, taux, baseCentimes: signe * m.base, tvaCentimes: signe * m.tva,
        ttcCentimes: signe * (m.base + m.tva),
      })
    }
  }
  pousserDocument(facture.date_emission, null, montantsFacture, 1)
  for (const { avoir, montants } of avoirsLus) pousserDocument(avoir.date_emission, avoir.id, montants, -1)

  // Les exigibilités de la CA3, selon le régime.
  const exigibilites: ExigibiliteVenteFacturee[] = []
  const depuisPart = (p: PartVenteFacturee): ExigibiliteVenteFacturee => ({
    ...nommee, origine: 'encaissement', encaissementId: p.encaissementId, avoirId: null, date: p.date, taux: p.taux,
    baseCentimes: p.htCentimes, tvaCentimes: p.tvaCentimes,
  })
  const depuisDocument = (d: DocumentVenteFacturee): ExigibiliteVenteFacturee => ({
    ...nommee, origine: d.avoirId ? 'avoir' : 'facture', encaissementId: null, avoirId: d.avoirId, date: d.date,
    taux: d.taux, baseCentimes: d.baseCentimes, tvaCentimes: d.tvaCentimes,
  })
  if (regime === 'encaissement') {
    exigibilites.push(...parts.map(depuisPart))
  } else {
    // Un bien, ou des services sur l'option pour les débits : un fait générateur L — la livraison, ou la date de la
    // facture. Les encaissements d'AVANT L à leur date : un acompte perçu avant le fait générateur ou le débit rend la
    // taxe exigible à sa perception (CGI, art. 269, 2-a et 2-c ; BOI-TVA-BASE-20-10, § 65 ; BOI-TVA-BASE-20-40 ;
    // directive 2006/112/CE, art. 65). À L, ce que la facture porte, nette des avoirs datés jusque-là, moins ce que ces
    // encaissements ont déjà rendu exigible ; un avoir d'après, à sa date. Un encaissement ou une contre-passation daté de
    // L ou après ne change rien à la CA3 : la taxe était due (l'impayé relève de la créance irrécouvrable, hors du
    // chantier).
    const L = regime === 'livraison' ? dateDeLivraison(facture) : facture.date_emission
    const avant = parts.filter((p) => p.date < L)
    exigibilites.push(...avant.map(depuisPart))
    const taux = new Set([...montantsFacture.keys(), ...avoirsLus.flatMap((a) => [...a.montants.keys()])])
    for (const t of [...taux].sort((a, b) => b - a)) {
      const { V, T } = netAu(t, L)
      const tvaAvant = avant.filter((p) => p.taux === t).reduce((s, p) => s + p.tvaCentimes, 0)
      const htAvant = avant.filter((p) => p.taux === t).reduce((s, p) => s + p.htCentimes, 0)
      const base = T - V - htAvant
      const tva = V - tvaAvant
      if (base === 0 && tva === 0) continue
      exigibilites.push({
        ...nommee, origine: regime === 'livraison' ? 'livraison' : 'facture', encaissementId: null, avoirId: null, date: L,
        taux: t, baseCentimes: base, tvaCentimes: tva,
      })
    }
    exigibilites.push(...documents.filter((d) => d.avoirId != null && d.date > L).map(depuisDocument))
  }

  return { parts, exigibilites, documents, excedents }
}

/**
 * Les ventes facturées du dossier : les factures VALIDÉES SOURCES de leur vente, leurs avoirs validés, et le registre de
 * leurs encaissements. Une facture qui n'est pas source n'y entre pas — sa vente est comptée par sa pièce, comme hier.
 */
export function ventesFacturees(sources: SourcesVentesFacturees): VentesFacturees {
  const duDossier = <T extends { dossier_id: string }>(l: readonly T[]) => l.filter((x) => x.dossier_id === sources.dossierId)
  const validees = duDossier(sources.factures).filter((f) => f.statut === 'validee' && f.source_de_la_vente)
  const ids = new Set(validees.map((f) => f.id))
  const encaissements = duDossier(sources.encaissements)
  const partsLues = duDossier(sources.parts)

  const resultat: VentesFacturees = {
    dossierId: sources.dossierId, parts: [], exigibilites: [], documents: [], ecartees: [], excedents: [], sources: ids,
  }
  const factures = validees.filter((f) => f.type === 'facture').sort((a, b) => ordreC(a.id, b.id))
  for (const facture of factures) {
    const avoirs = validees.filter((a) => a.type === 'avoir' && a.facture_origine_id === facture.id)
    const r = uneFacture(facture, avoirs, sources.lignes, encaissements.filter((e) => e.facture_id === facture.id), partsLues)
    if ('ecart' in r) {
      resultat.ecartees.push({ factureId: facture.id, numero: facture.numero, tiers: facture.tiers_nom, ...r.ecart })
      continue
    }
    resultat.parts.push(...r.parts)
    resultat.exigibilites.push(...r.exigibilites)
    resultat.documents.push(...r.documents)
    resultat.excedents.push(...r.excedents)
  }
  // Un ordre qui ne dépend pas de la lecture : la date ; à égalité, celui du calcul (la facture, puis ses événements).
  const parDate = <T extends { date: string }>(l: T[]) => l.map((x, i) => [x, i] as const)
    .sort((a, b) => ordreC(a[0].date, b[0].date) || a[1] - b[1]).map(([x]) => x)
  resultat.parts = parDate(resultat.parts)
  resultat.exigibilites = parDate(resultat.exigibilites)
  resultat.documents = parDate(resultat.documents)
  return resultat
}

/**
 * La pièce est-elle l'EXEMPLAIRE d'une facture source (§ 8) ? Désignée à une facture ou un avoir source, elle prouve la
 * vente et ne la compte plus : c'est la facture qui la compte. Une pièce désignée à une facture qui n'est pas source
 * compte comme hier — le pont (lib/ventesJumelles.ts) dit seulement quand elle double sa jumelle.
 */
export function exemplaireDUneFactureSource(
  piece: Pick<Piece, 'facture_id'>, ventes: Pick<VentesFacturees, 'sources'>,
): boolean {
  return piece.facture_id != null && ventes.sources.has(piece.facture_id)
}

/**
 * Les recettes des ventes facturées d'une période, en centimes, hors taxes (h ; le TTC à 0 %) : en trésorerie, les parts
 * de ses encaissements datées dans la période (la 2035, sa situation à date, l'estimation) ; en engagement, la facture et
 * ses avoirs datés dans la période. Bornes comprises.
 */
export function recettesFactureesDeLaPeriode(
  ventes: Pick<VentesFacturees, 'parts' | 'documents'>, debut: string, fin: string, mode: ModeComptable,
): number {
  const dans = (d: { date: string }) => d.date >= debut && d.date <= fin
  return mode === 'tresorerie'
    ? ventes.parts.filter(dans).reduce((s, p) => s + p.htCentimes, 0)
    : ventes.documents.filter(dans).reduce((s, d) => s + d.baseCentimes, 0)
}
