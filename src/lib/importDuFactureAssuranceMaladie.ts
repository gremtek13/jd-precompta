import type { FactureDesBordereaux } from './factureAssuranceMaladie'

// L'IMPORT DU FACTURÉ À L'ASSURANCE MALADIE, CE QUI PART EN BASE ET CE QUE LA BASE REFUSE (conception 59, lot BOR3 ;
// docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md, § 14 ; la migration :
// supabase/schema/20261120110200_factures_assurance_maladie.sql, en production depuis le 20/11/2026). La décision du cabinet du
// 16/11/2026 : « on récupère que les chiffres et on stocke pas de données patients ».
//
// UN MODULE PUR, ET SANS SORTIE (bordereauDeTeletransmissionSansSortie.test.ts le garde, défauts plantés compris) : il ne lit
// rien en base, n'appelle personne, ne journalise rien, ne lit ni l'horloge (le jour est un PARAMÈTRE) ni le stockage du
// navigateur ; il n'importe que le type du facturé (BOR2). Il dit :
//   - LE CORPS DE L'APPEL D'IMPORT (`corpsDeLImportDuFacture`) : la traduction de ce que BOR2 a rendu (lib/
//     factureAssuranceMaladie.ts, l'état « prêt ») dans la forme que `importer_factures_assurance_maladie` accepte, la
//     version 1 — les LOTS (le numéro, la date de création, la caisse, le nombre de factures) et les TOTAUX (par date de
//     création, part et organisme : la part obligatoire sous son régime et sa caisse, la part complémentaire sous un organisme
//     non dit, BORQ5-Q1 (A)). Le numéro d'un lot n'y entre que pour l'appel : c'est la base qui en calcule l'empreinte, sous la
//     clé secrète du dossier, et l'oublie (BOR1Q1-Q1 (A)). Le corps se compose AU MOMENT de l'appel, ne se garde pas, ne se
//     montre pas et ne se journalise jamais : ce qui se montre avant le clic est le résumé de BOR2, qui ne porte aucun numéro ;
//   - LES REFUS DE LA BASE, sous les mêmes mots et dans le même ordre (`refusDeLImportDuFacture`, la fonction
//     `refus_de_l_import_des_factures_assurance_maladie` redite ; importDuFactureAssuranceMaladie.test.ts relit ses constantes
//     dans le texte de la migration et rejuge un relevé de la base, importDuFactureAssuranceMaladie.releve.json), et les deux
//     refus que la fonction d'import seule peut dire — le registre ne se lit par aucun rôle de l'API : un lot déjà importé,
//     un lot dans la période d'un import restauré — composés à ses mots (`refusDuLotDejaImporte`, `refusDuLotDUnImportRestaure`).

/** Le drapeau de la BASE, à part de celui de l'écran (le patron de `COMPTES_BANCAIRES_EN_BASE`) : la migration
 *  `factures_assurance_maladie` (BOR3) est en production depuis le 20/11/2026 (collée, 248). Levé, le plan de sauvegarde
 *  porte ses quatre tables (la clé et le registre lus vides : aucune policy) et l'écran de la restauration dit ce que la
 *  sauvegarde tait (lib/restaurationInterrompue.ts). Baissé (son état d'avant, que les tests jouent encore), le plan ne les
 *  nommait pas : une sauvegarde aurait lu des tables absentes et échoué. */
export const FACTURES_ASSURANCE_MALADIE_EN_BASE = true

/** Le drapeau de l'ÉCRAN d'import du facturé (BOR4, pas encore écrit) : baissé, aucun écran ne lit ni n'écrit les quatre
 *  tables. Il se lève avec l'écran, fini (BOR7). */
export const FACTURES_ASSURANCE_MALADIE_PREVUES = false

/** Un lot, tel qu'il part à l'appel : ses quatre clés, et aucune autre. Le numéro ne s'écrit nulle part en base. */
export interface LotAEnvoyer {
  numero: number
  cree_le: string
  caisse: number
  nombre_de_factures: number
}

/** Un total du facturé, tel qu'il part en base : ses huit clés, et aucune autre. */
export interface TotalAEnvoyer {
  date_creation_lot: string
  part: 'obligatoire' | 'complementaire'
  regime: number | null
  caisse: number | null
  /** L'organisme complémentaire en chiffres, de la seule part complémentaire ; nul : non dit (BORQ5-Q1 (A)). */
  organisme_complementaire: number | null
  montant_centimes: number
  nombre_de_lots: number
  nombre_de_factures: number
}

/** Ce que reçoit `importer_factures_assurance_maladie` : la version 1, ses trois clés. */
export interface ImportDuFactureAEnvoyer {
  version: 1
  lots: LotAEnvoyer[]
  agregats: TotalAEnvoyer[]
}

// ── Les mots de la base ────────────────────────────────────────────────────────────────────────────────────────────────
// Les huit constantes de `refus_de_l_import_des_factures_assurance_maladie`, au caractère près et dans leur ordre
// (importDuFactureAssuranceMaladie.test.ts les relit dans le texte de la migration), puis ceux de la fonction d'import.
export const REFUS_DE_L_IMPORT_DU_FACTURE = {
  forme: 'L\'import du facturé n\'est pas dans la forme que la base connaît (version 1).',
  nombre: 'Un import du facturé porte de 1 à 2 000 lots et au plus 5 000 totaux.',
  lot: 'Un lot de l\'import est mal formé : un numéro de 1 à 999 999 999, une date de création, une caisse de trois chiffres au plus et un nombre de factures de 1 à 10 000.',
  aVenir: 'Un lot de l\'import porte une date de création à venir.',
  doublonLot: 'L\'import porte deux fois le même lot : un même numéro, une même date de création et une même caisse.',
  total: 'Un total de l\'import est mal formé : une date de création, une part de la liste, son organisme (le régime et la caisse pour la part obligatoire ; rien, ou l\'organisme complémentaire en chiffres, pour la part complémentaire), un montant en centimes entiers, un nombre de lots et un nombre de factures.',
  doublonTotal: 'L\'import porte deux fois le même total : une même date de création, une même part et un même organisme.',
  coherence: 'Les totaux de l\'import ne se tiennent pas avec ses lots : chacun porte la date de création d\'un lot (et, pour la part obligatoire, la caisse de ce lot), et ne compte pas plus de lots ni de factures que ces lots n\'en portent.',
} as const

export const REFUS_DE_LA_FONCTION_DU_FACTURE = {
  acces: 'Accès refusé à ce dossier.',
} as const

/** Une date AAAA-MM-JJ en JJ/MM/AAAA, comme `to_char(…, 'DD/MM/YYYY')`. */
const enJourMoisAnnee = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`

/** Le refus d'un lot déjà au registre : son rang dans l'envoi (depuis un) et le jour, à Paris, de l'import qui l'a apporté. */
export function refusDuLotDejaImporte(rang: number, jourDeLImport: string): string {
  return `Le bordereau ${rang} de l'envoi a déjà été importé le ${enJourMoisAnnee(jourDeLImport)} : un lot ne s'importe pas deux fois.`
}

/** Le refus d'un lot créé dans la période d'un import restauré (sans registre) : la plus ancienne date en cause. */
export function refusDuLotDUnImportRestaure(jour: string): string {
  return `Un import restauré, dont la sauvegarde ne porte pas le registre des lots, couvre le ${enJourMoisAnnee(jour)} : `
    + 'le retirer d\'abord, puis réimporter ses bordereaux.'
}

// ── La forme d'un import, redite (`refus_de_l_import_des_factures_assurance_maladie`) ────────────────────────────────────
const PLAFOND = 100_000_000_000_000
const CLES_DE_L_IMPORT = ['agregats', 'lots', 'version']
const CLES_D_UN_LOT = ['caisse', 'cree_le', 'nombre_de_factures', 'numero']
const CLES_D_UN_TOTAL = ['caisse', 'date_creation_lot', 'montant_centimes', 'nombre_de_factures', 'nombre_de_lots',
  'organisme_complementaire', 'part', 'regime']

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// L'ordre `collate "C"` de la base : celui des points de code, celui de `<` sur des clés ASCII.
const memesCles = (o: Record<string, unknown>, attendues: readonly string[]) => {
  const cles = Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return cles.length === attendues.length && cles.every((c, i) => c === attendues[i])
}
const estEntier = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const estNombre = (v: unknown): v is number => typeof v === 'number'

/** Un jour civil AAAA-MM-JJ qui existe au calendrier, depuis le 1er janvier 1990 (la borne de BOR1 et de la base). */
export function estUneDateDeLot(texte: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte)
  if (!m) return false
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (annee < 1990 || mois < 1 || mois > 12 || jour < 1) return false
  const bissextile = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0
  return jour <= [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mois - 1]
}

/**
 * Le refus, en mots, d'un import du facturé pour le jour de Paris donné (AAAA-MM-JJ), ou nul : la fonction
 * `refus_de_l_import_des_factures_assurance_maladie` de la base, dans son ordre — la forme, le nombre des lots et des totaux,
 * chaque lot (mal formé, puis créé à venir), deux lots de même empreinte, chaque total, deux totaux de même clé, les totaux
 * confrontés aux lots.
 */
export function refusDeLImportDuFacture(imp: unknown, jour: string): string | null {
  const R = REFUS_DE_L_IMPORT_DU_FACTURE
  if (!estUneDateDeLot(jour)) return R.aVenir
  if (!estObjet(imp) || !memesCles(imp, CLES_DE_L_IMPORT)) return R.forme
  if (imp.version !== 1 || !Array.isArray(imp.lots) || !Array.isArray(imp.agregats)) return R.forme
  const lots: unknown[] = imp.lots
  const totaux: unknown[] = imp.agregats
  if (lots.length < 1 || lots.length > 2000 || totaux.length > 5000) return R.nombre

  for (const l of lots) {
    if (!estObjet(l) || !memesCles(l, CLES_D_UN_LOT)) return R.lot
    if (!estNombre(l.numero) || typeof l.cree_le !== 'string' || !estNombre(l.caisse) || !estNombre(l.nombre_de_factures)) return R.lot
    if (!estUneDateDeLot(l.cree_le)) return R.lot
    if (!estEntier(l.numero) || l.numero < 1 || l.numero > 999_999_999
      || !estEntier(l.caisse) || l.caisse < 0 || l.caisse > 999
      || !estEntier(l.nombre_de_factures) || l.nombre_de_factures < 1 || l.nombre_de_factures > 10_000) return R.lot
    if (l.cree_le > jour) return R.aVenir
  }
  const lotsLus = lots as LotAEnvoyer[]
  const empreintes = new Set<string>()
  for (const l of lotsLus) {
    const cle = `${l.numero}|${l.cree_le}|${l.caisse}`
    if (empreintes.has(cle)) return R.doublonLot
    empreintes.add(cle)
  }

  for (const t of totaux) {
    if (!estObjet(t) || !memesCles(t, CLES_D_UN_TOTAL)) return R.total
    if (typeof t.date_creation_lot !== 'string' || typeof t.part !== 'string'
      || !(t.regime === null || estNombre(t.regime)) || !(t.caisse === null || estNombre(t.caisse))
      || !(t.organisme_complementaire === null || estNombre(t.organisme_complementaire))
      || !estNombre(t.montant_centimes) || !estNombre(t.nombre_de_lots) || !estNombre(t.nombre_de_factures)) return R.total
    if (!estUneDateDeLot(t.date_creation_lot)) return R.total
    if (t.part !== 'obligatoire' && t.part !== 'complementaire') return R.total
    const { regime, caisse, organisme_complementaire: organisme } = t
    if (t.part === 'obligatoire' && (regime === null || !estEntier(regime) || regime < 0 || regime > 99
      || caisse === null || !estEntier(caisse) || caisse < 0 || caisse > 999 || organisme !== null)) return R.total
    if (t.part === 'complementaire' && (regime !== null || caisse !== null
      || (organisme !== null && (!estEntier(organisme) || organisme < 1 || organisme > 9_999_999_999)))) return R.total
    if (!estEntier(t.montant_centimes) || Math.abs(t.montant_centimes) >= PLAFOND
      || !estEntier(t.nombre_de_lots) || t.nombre_de_lots < 1 || t.nombre_de_lots > 2000
      || !estEntier(t.nombre_de_factures) || t.nombre_de_factures < t.nombre_de_lots || t.nombre_de_factures > 100_000_000) return R.total
  }
  const totauxLus = totaux as TotalAEnvoyer[]
  const cles = new Set<string>()
  for (const t of totauxLus) {
    const cle = `${t.date_creation_lot}|${t.part}|${t.regime ?? '-'}|${t.caisse ?? '-'}|${t.organisme_complementaire ?? '-'}`
    if (cles.has(cle)) return R.doublonTotal
    cles.add(cle)
  }

  // Les totaux et les lots : la date (et, pour la part obligatoire, la caisse) d'un lot ; pas plus de lots ni de factures.
  const lotsDuJour = (jourDuLot: string, caisse: number | null) =>
    lotsLus.filter((l) => l.cree_le === jourDuLot && (caisse === null || l.caisse === caisse))
  for (const t of totauxLus) {
    if (lotsDuJour(t.date_creation_lot, t.part === 'obligatoire' ? t.caisse : null).length === 0) return R.coherence
  }
  const sommes = new Map<string, { jour: string; caisse: number | null; lots: number; factures: number }>()
  for (const t of totauxLus) {
    const caisse = t.part === 'obligatoire' ? t.caisse : null
    const cle = `${t.part}|${t.date_creation_lot}|${caisse ?? '-'}`
    const s = sommes.get(cle) ?? { jour: t.date_creation_lot, caisse, lots: 0, factures: 0 }
    s.lots += t.nombre_de_lots
    s.factures += t.nombre_de_factures
    sommes.set(cle, s)
  }
  for (const s of sommes.values()) {
    const duJour = lotsDuJour(s.jour, s.caisse)
    if (s.lots > duJour.length || s.factures > duJour.reduce((n, l) => n + l.nombre_de_factures, 0)) return R.coherence
  }
  return null
}

// ── Le corps de l'appel ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Le corps de `importer_factures_assurance_maladie` pour ce que BOR2 a rendu prêt : les lots (leurs numéros, pris à
 * `pourLAppelDImport`, une fonction que `JSON.stringify` saute) et les totaux. À composer AU MOMENT de l'appel, jamais à
 * garder, montrer ni journaliser : il porte les numéros des lots, que la base seule transforme en empreintes.
 */
export function corpsDeLImportDuFacture(facture: Extract<FactureDesBordereaux, { etat: 'pret' }>): ImportDuFactureAEnvoyer {
  return {
    version: 1,
    lots: facture.identificationDesLots.pourLAppelDImport().map((l) => ({
      numero: l.numero, cree_le: l.creeLe, caisse: l.caisse, nombre_de_factures: l.nombreDeFactures,
    })),
    agregats: facture.agregats.map((a) => ({
      date_creation_lot: a.date,
      part: a.part,
      regime: a.part === 'obligatoire' ? a.regime : null,
      caisse: a.part === 'obligatoire' ? a.caisse : null,
      organisme_complementaire: null,
      montant_centimes: a.montantCentimes,
      nombre_de_lots: a.nombreDeLots,
      nombre_de_factures: a.nombreDeFactures,
    })),
  }
}
