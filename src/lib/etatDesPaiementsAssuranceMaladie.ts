import {
  cleDUnPaiement, estUneJourneeComptable, type ImportAEnvoyer, type PaiementAgrege, type PartDUneLigne,
} from './paiementsAssuranceMaladie'
import { regimeChoisi } from './regimesAssuranceMaladie'

// L'ÉTAT DES PAIEMENTS DE L'ASSURANCE MALADIE, RANGÉ AUX AGRÉGATS DE LA BASE (conception 53, § 12 ; conception 59, § 1.2, § 5
// et § 8 ; le « lecteur du PDF des paiements » que CLAUDE.md compte parmi les restes de NOEMIE). PREMIÈRE PARTIE SEULEMENT :
// LE RANGEMENT. Le gabarit qui lira la page — ses ancres, ses colonnes, la forme imprimée de l'organisme et des montants —
// attend une page réelle rendue anonyme (BOR6-Q2 (A), 21/11/2026 ; la recherche du 19/11/2026 n'a trouvé ni exemplaire ni
// capture de l'état : HISTORIQUE.md, « L'ÉTAT DES PAIEMENTS NOEMIE DE TÉLÉVITALE »). L'écrire sans elle serait deviner.
//
// CE QUI EST ÉTABLI, ET QUE CE MODULE TIENT POUR ACQUIS (les manuels de l'éditeur, conception 59, § 1.2) : l'état « Paiement
// Noemie par journée comptable » se sort pour UNE journée comptable et UNE caisse ; il porte le montant payé acte par acte,
// « avec un total par facture, par lot, par journée », et aussi ce qui ne paie aucune facture du logiciel : les aides, les
// indus ou trop-perçus (des montants négatifs), les régularisations de la caisse ; les paiements de factures faites hors du
// logiciel y sont aussi. Ce que la base admet de cet état, et comment elle le range, est fixé par la migration des paiements de
// l'assurance maladie (NOE3, 246), amendée le 19/11/2026 (son essai, étapes 60 à 72) :
//   - le total d'une facture, positif : le montant payé de sa part (obligatoire, complémentaire), une facture de plus ;
//   - une somme négative, qu'elle porte sur une facture ou non : une régularisation de sa part, déduite du net (le net peut
//     être négatif, le brut jamais) ;
//   - une somme positive qui ne paie aucune facture (une aide) : un `forfait`, sous l'organisme de l'état ; la base refuse une
//     somme positive sans facture sur la part obligatoire, et n'admet un organisme complémentaire que sur la part
//     complémentaire : une somme versée sans facture par une COMPLÉMENTAIRE ne se range donc pas, et son état s'écarte ;
//   - les rejets : l'état ne paie que ce qui est payé (le « rapport Noemie par lot » porte les rejets, et ne justifie pas un
//     virement) ; l'import les dit « non dits » (nuls), jamais zéro.
//
// CE QUE LE GABARIT À VENIR REND ICI, ET RIEN D'AUTRE : par état, sa journée comptable (AAAA-MM-JJ), son organisme payeur —
// une caisse sous son régime (de la liste fermée, lu ou choisi par celui qui importe, lib/regimesAssuranceMaladie.ts) et son
// code, ou une complémentaire sous son numéro ou « non dit » —, le total de la journée s'il est imprimé, et ses lignes : la
// part, si elle paie une facture, un montant signé en centimes. AUCUN TEXTE n'entre ni ne sort : des dates, des entiers, des
// booléens et des unions littérales (le canari d'etatDesPaiementsAssuranceMaladie.test.ts le prouve sur la sortie
// sérialisée). Ni nom, ni NIR, ni date de soins, ni acte, ni numéro de facture ou de lot, ni référence de virement.
//
// TOUT DOUTE ÉCARTE L'ÉTAT ENTIER, ET SE COMPTE SOUS SON RANG ET SA RAISON, JAMAIS SA VALEUR : un état écarté n'apporte
// aucune ligne à aucun agrégat (un agrégat en partie lu aurait d'autres chiffres que le crédit du relevé qu'il justifie, et
// la clé TOTALE de la base le figerait) ; les autres états du même envoi se rangent. Un total imprimé que les lignes ne font
// pas écarte l'état — le contrôle de solde d'un relevé ; sans total imprimé, rien ne confirme la lecture, et l'état se compte
// à part (`sansTotal`) pour que l'écran le dise. La même journée sous le même organisme deux fois dans l'envoi est un doute :
// les deux s'écartent (deux fichiers du même jour ne se tranchent pas en silence).
//
// UN MODULE PUR, ET SANS SORTIE : il ne lit rien en base, n'appelle personne, ne journalise rien, ne lit ni l'horloge (le jour
// de Paris est un PARAMÈTRE) ni le stockage du navigateur (paiementsAssuranceMaladieSansSortie.test.ts le garde). Il ne nomme
// aucune table : l'import part, au clic, par la fonction de l'écran de NOE4, après `refusAvantLEnvoi`.

/** L'organisme qui paie l'état : une caisse (la part obligatoire, et la complémentaire qu'elle verse en gestion unique), ou
 *  une complémentaire (en gestion séparée), sous son numéro ou nul (« non dit »). */
export type OrganismePayeur =
  | { genre: 'caisse'; regime: number; caisse: number }
  | { genre: 'complementaire'; organisme: number | null }

/** Une ligne de l'état, telle que le gabarit la rend : sa part, si elle paie une facture, son montant signé en centimes. */
export interface LigneDeLEtat {
  part: PartDUneLigne
  /** Vrai : le total d'une facture (faite dans le logiciel ou hors de lui). Faux : une aide, un indu, une régularisation. */
  paieUneFacture: boolean
  montant_centimes: number
}

/** Un état lu : une journée comptable, un organisme, ses lignes, le total de la journée s'il est imprimé. */
export interface EtatDesPaiementsLu {
  journee: string
  organisme: OrganismePayeur
  lignes: readonly LigneDeLEtat[]
  totalImprimeCentimes: number | null
}

export type RaisonDEcartDUnEtat =
  | 'journee' | 'a_venir' | 'organisme' | 'montant' | 'part' | 'total' | 'versement_complementaire' | 'vide' | 'deux_fois'

/** Les raisons, aux mots de l'écran : sans majuscule, l'écran les place après « État n° … : ». */
export const LIBELLES_DES_ETATS_ECARTES: Readonly<Record<RaisonDEcartDUnEtat, string>> = {
  journee: 'journée comptable illisible',
  a_venir: 'journée comptable à venir',
  organisme: 'organisme payeur hors de la liste des régimes, ou dont le code n’est pas en chiffres',
  montant: 'un montant qui n’est pas un nombre entier de centimes dans ses bornes',
  part: 'une ligne de la part obligatoire sur l’état d’une complémentaire',
  total: 'ses lignes ne font pas le total que l’état imprime',
  versement_complementaire: 'une somme versée sans facture par une complémentaire, que la base ne range pas',
  vide: 'aucun montant payé',
  deux_fois: 'la même journée comptable et le même organisme deux fois dans l’envoi',
}

/** Un état écarté : son rang dans l'envoi (depuis un) et sa raison. JAMAIS une valeur de l'état. */
export interface EtatEcarte {
  rang: number
  raison: RaisonDEcartDUnEtat
}

export interface RangementDesEtats {
  /** Les paiements agrégés, dans l'ordre de leur clé. */
  paiements: PaiementAgrege[]
  /** La plus ancienne et la plus récente journée comptable des paiements ; nulle sans paiement. */
  periode: { du: string; au: string } | null
  /** Les états de l'envoi, et ceux qui se sont rangés. */
  etats: number
  ranges: number
  /** Les états rangés sans total imprimé : rien ne confirme leur lecture, l'écran le dit. */
  sansTotal: number
  ecartes: EtatEcarte[]
  /** Les lignes à zéro d'un état rangé : pas un paiement. */
  lignesSansMontant: number
}

// Les bornes de la base (`refus_de_l_import_assurance_maladie`), redites ici pour qu'un agrégat ne les passe pas.
const PLAFOND = 100_000_000_000_000
const FACTURES_MAX = 100_000
const ORGANISME_COMPLEMENTAIRE_MAX = 9_999_999_999

const entierDans = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max
const montantSur = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) < PLAFOND

function organismeSur(o: OrganismePayeur): boolean {
  if (o.genre === 'caisse') return entierDans(o.regime, 1, 99) && regimeChoisi(o.regime) !== null && entierDans(o.caisse, 0, 999)
  if (o.genre === 'complementaire') return o.organisme === null || entierDans(o.organisme, 1, ORGANISME_COMPLEMENTAIRE_MAX)
  return false
}

/** L'identité d'un état dans l'envoi : sa journée et son organisme. */
function identiteDe(e: EtatDesPaiementsLu): string {
  const o = e.organisme
  return o.genre === 'caisse' ? `${e.journee}|c|${o.regime}|${o.caisse}` : `${e.journee}|m|${o.organisme ?? '-'}`
}

type Jugement =
  | { etat: 'range'; agregats: PaiementAgrege[]; sansMontant: number }
  | { etat: 'ecarte'; raison: RaisonDEcartDUnEtat }

/** Le jugement d'un état seul : sa forme, son total, puis ses lignes rangées aux agrégats de la base. */
function jugerLEtat(e: EtatDesPaiementsLu, jour: string): Jugement {
  if (typeof e.journee !== 'string' || !estUneJourneeComptable(e.journee)) return { etat: 'ecarte', raison: 'journee' }
  if (!estUneJourneeComptable(jour) || e.journee > jour) return { etat: 'ecarte', raison: 'a_venir' }
  if (!organismeSur(e.organisme)) return { etat: 'ecarte', raison: 'organisme' }
  for (const l of e.lignes) {
    if ((l.part !== 'obligatoire' && l.part !== 'complementaire') || typeof l.paieUneFacture !== 'boolean') {
      return { etat: 'ecarte', raison: 'part' }
    }
    if (!montantSur(l.montant_centimes)) return { etat: 'ecarte', raison: 'montant' }
    if (e.organisme.genre === 'complementaire' && l.part === 'obligatoire') return { etat: 'ecarte', raison: 'part' }
  }
  if (e.totalImprimeCentimes !== null) {
    if (!montantSur(e.totalImprimeCentimes)) return { etat: 'ecarte', raison: 'montant' }
    const somme = e.lignes.reduce((s, l) => s + l.montant_centimes, 0)
    if (somme !== e.totalImprimeCentimes) return { etat: 'ecarte', raison: 'total' }
  }

  const o = e.organisme
  const regime = o.genre === 'caisse' ? o.regime : null
  const caisse = o.genre === 'caisse' ? o.caisse : null
  const agregats = new Map<string, PaiementAgrege>()
  const agregat = (part: PaiementAgrege['part']): PaiementAgrege => {
    const organisme_complementaire = part === 'complementaire' && o.genre === 'complementaire' ? o.organisme : null
    const cle = cleDUnPaiement({ date_journee_comptable: e.journee, regime, caisse, part, organisme_complementaire })
    const deja = agregats.get(cle)
    if (deja) return deja
    const neuf: PaiementAgrege = {
      date_journee_comptable: e.journee, regime, caisse, organisme_complementaire, part,
      montant_centimes: 0, regularisations_centimes: 0, nombre_de_factures: 0,
    }
    agregats.set(cle, neuf)
    return neuf
  }
  let sansMontant = 0
  for (const l of e.lignes) {
    const m = l.montant_centimes
    if (m === 0) {
      sansMontant++
      continue
    }
    if (m < 0) {
      // Un indu, un trop-perçu, une régularisation qui reprend : déduit du net de sa part, sur une facture ou non.
      const a = agregat(l.part)
      a.montant_centimes += m
      a.regularisations_centimes += m
      continue
    }
    if (l.paieUneFacture) {
      const a = agregat(l.part)
      a.montant_centimes += m
      a.nombre_de_factures++
      continue
    }
    // Une somme positive sans facture : une aide de la caisse, un forfait sous son organisme ; d'une complémentaire, la base
    // n'a pas où la ranger.
    if (l.part === 'complementaire') return { etat: 'ecarte', raison: 'versement_complementaire' }
    agregat('forfait').montant_centimes += m
  }
  const rendus = [...agregats.values()]
  if (rendus.length === 0) return { etat: 'ecarte', raison: 'vide' }
  for (const a of rendus) {
    const brut = a.montant_centimes - a.regularisations_centimes
    if (!montantSur(a.montant_centimes) || a.regularisations_centimes <= -PLAFOND || brut >= PLAFOND
      || a.nombre_de_factures > FACTURES_MAX) {
      return { etat: 'ecarte', raison: 'montant' }
    }
  }
  return { etat: 'range', agregats: rendus, sansMontant }
}

/**
 * Les paiements d'un envoi d'états, pour le jour de Paris donné (AAAA-MM-JJ) : chaque état jugé seul, rangé tout entier ou
 * écarté tout entier ; la même journée sous le même organisme deux fois écarte les deux.
 */
export function rangerLesEtatsDesPaiements(etats: readonly EtatDesPaiementsLu[], jour: string): RangementDesEtats {
  const occurrences = new Map<string, number>()
  for (const e of etats) {
    if (typeof e.journee === 'string' && estUneJourneeComptable(e.journee) && organismeSur(e.organisme)) {
      occurrences.set(identiteDe(e), (occurrences.get(identiteDe(e)) ?? 0) + 1)
    }
  }
  const parCle = new Map<string, PaiementAgrege>()
  const ecartes: EtatEcarte[] = []
  let ranges = 0
  let sansTotal = 0
  let lignesSansMontant = 0
  etats.forEach((e, i) => {
    const rang = i + 1
    const jugement = jugerLEtat(e, jour)
    if (jugement.etat === 'ecarte') {
      ecartes.push({ rang, raison: jugement.raison })
      return
    }
    if ((occurrences.get(identiteDe(e)) ?? 0) > 1) {
      ecartes.push({ rang, raison: 'deux_fois' })
      return
    }
    ranges++
    if (e.totalImprimeCentimes === null) sansTotal++
    lignesSansMontant += jugement.sansMontant
    for (const a of jugement.agregats) parCle.set(cleDUnPaiement(a), a)
  })
  const paiements = [...parCle.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, p]) => p)
  const journees = paiements.map((p) => p.date_journee_comptable).sort()
  return {
    paiements,
    periode: journees.length === 0 ? null : { du: journees[0], au: journees[journees.length - 1] },
    etats: etats.length,
    ranges,
    sansTotal,
    ecartes,
    lignesSansMontant,
  }
}

/** L'import qui partirait en base, ou nul sans paiement : la version 1, ses trois clés ; les rejets « non dits ». */
export function importDesEtats(r: RangementDesEtats): ImportAEnvoyer | null {
  if (r.paiements.length === 0) return null
  return {
    version: 1,
    paiements: r.paiements.map((p) => ({
      date_journee_comptable: p.date_journee_comptable, regime: p.regime, caisse: p.caisse,
      organisme_complementaire: p.organisme_complementaire, part: p.part,
      montant_centimes: p.montant_centimes, regularisations_centimes: p.regularisations_centimes,
      nombre_de_factures: p.nombre_de_factures,
    })),
    rejets: null,
  }
}

/** Les états écartés, dits à l'écran : un par ligne, sous leur rang et leur raison, jamais une valeur. */
export function etatsEcartesDits(r: RangementDesEtats): string[] {
  return r.ecartes.map((e) => `État n° ${e.rang} : ${LIBELLES_DES_ETATS_ECARTES[e.raison]}.`)
}
