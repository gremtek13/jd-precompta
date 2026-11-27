import type { EspaceVentes } from './espaceVentes'
import { formatDate, formatMoney } from './format'
import type { BordereauLu, LectureDuBordereau } from './bordereauDeTeletransmission'
import type { AgregatDuFacture, ChoixDuRegime, FactureDesBordereaux, OrganismeAChoisir, ResumeDuFacture } from './factureAssuranceMaladie'
import { corpsDeLImportDuFacture, refusDeLImportDuFacture } from './importDuFactureAssuranceMaladie'
import { GRANDS_REGIMES, codeDuRegime, regimeChoisi, regimeDuLibelle } from './regimesAssuranceMaladie'
import type { FactureAssuranceMaladie, ImportFacturesAssuranceMaladie } from './types'

// LES MOTS ET LES RÈGLES DE L'ÉCRAN D'IMPORT DU FACTURÉ À L'ASSURANCE MALADIE (conception 59, lot BOR4 ;
// docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md, § 5.4, § 13.5 et § 15). La lecture d'un bordereau : BOR1
// (lib/bordereauDeTeletransmission.ts, ouvert par lib/bordereauDeTeletransmissionLecture.ts) ; les agrégats : BOR2
// (lib/factureAssuranceMaladie.ts) ; le corps de l'appel et les refus de la base : lib/importDuFactureAssuranceMaladie.ts ; la
// lecture en base : lib/factureAssuranceMaladieLecture.ts ; l'écran : components/FactureAssuranceMaladie.tsx.
//
// UN MODULE PUR, ET SANS SORTIE (bordereauDeTeletransmissionSansSortie.test.ts le garde) : ni base, ni horloge (le jour est un
// PARAMÈTRE), ni fichier, ni journal. Chaque phrase a ses deux formes : le client tutoyé, le cabinet à l'infinitif.
//
// CE QUI SE MONTRE AVANT LE CLIC, ET RIEN D'AUTRE : le nom du fichier choisi (dans ce navigateur, à celui qui l'a choisi), le
// rang de ses bordereaux dans l'envoi (les refus de BOR2 et de la base le citent), les raisons d'un refus ; puis les agrégats de
// BOR2 — la date de création des lots, l'organisme (un régime et un code de caisse, ou un organisme complémentaire « non dit »),
// la part, le montant, le nombre de lots et de factures (un ordre de grandeur). Jamais un numéro de lot : il ne sort de BOR2 que
// par `pourLAppelDImport`, que ce module n'appelle que pour juger l'envoi comme la base le jugera (`refusAvantLEnvoiDuFacture`) :
// le corps se compose, se juge et s'oublie dans la fonction, qui ne rend que le refus ; jamais une ligne d'un bordereau.

/** Un fichier de bordereaux, au plus : Télévitale imprime quelques dizaines de factures par page ; au-delà, ce n'est sans doute
 *  pas le bon fichier (la borne des pièces). */
export const TAILLE_BORDEREAU_MAX = 20 * 1024 * 1024

export function refusDeLaTailleDuBordereau(octets: number, espace: EspaceVentes): string | null {
  if (octets <= TAILLE_BORDEREAU_MAX) return null
  return espace === 'client'
    ? 'ce fichier pèse plus de 20 Mo : un bordereau de télétransmission pèse bien moins. Vérifie que c’est le bon fichier'
    : 'ce fichier pèse plus de 20 Mo : un bordereau de télétransmission pèse bien moins. Vérifier que c’est le bon fichier'
}

/** Un fichier de l'envoi, lu dans ce navigateur : son nom (montré à celui qui l'a choisi, jamais envoyé) et ce que BOR1 en a
 *  rendu, ou le refus de sa taille. */
export interface FichierDeLEnvoi {
  cle: number
  nom: string
  lecture: LectureDuBordereau
}

/** Un fichier de l'envoi, tel que l'écran le dit : lu (le rang de ses bordereaux dans l'envoi) ou refusé (sa raison). */
export type FichierDit =
  | { cle: number; nom: string; etat: 'lu'; premier: number; dernier: number }
  | { cle: number; nom: string; etat: 'refuse'; raison: string }

/** Les fichiers de l'envoi, dans leur ordre, et leurs bordereaux mis bout à bout : le rang d'un bordereau est celui de l'envoi
 *  entier, celui que citent les refus de BOR2 et de la base. */
export function fichiersDeLEnvoi(fichiers: readonly FichierDeLEnvoi[]): { dits: FichierDit[]; bordereaux: BordereauLu[] } {
  const dits: FichierDit[] = []
  const bordereaux: BordereauLu[] = []
  for (const f of fichiers) {
    if (f.lecture.etat === 'refuse') {
      dits.push({ cle: f.cle, nom: f.nom, etat: 'refuse', raison: f.lecture.raison })
      continue
    }
    const premier = bordereaux.length + 1
    bordereaux.push(...f.lecture.bordereaux)
    dits.push({ cle: f.cle, nom: f.nom, etat: 'lu', premier, dernier: bordereaux.length })
  }
  return { dits, bordereaux }
}

/** Ce qu'un fichier lu porte, en mots : le nombre de ses bordereaux et leurs rangs dans l'envoi. */
export function fichierLuDit(f: Extract<FichierDit, { etat: 'lu' }>): string {
  const n = f.dernier - f.premier + 1
  return n === 1 ? `1 bordereau (le bordereau ${f.premier} de l’envoi)` : `${n} bordereaux (${f.premier} à ${f.dernier} de l’envoi)`
}

/** Le refus d'un envoi qui porte un fichier refusé : rien ne part tant qu'il y est (tout ou rien). */
export function refusDesFichiers(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Un fichier de l’envoi est refusé : rien ne peut partir tant qu’il y est. Retire-le de l’envoi, ou choisis d’autres fichiers.'
    : 'Un fichier de l’envoi est refusé : rien ne peut partir tant qu’il y est. Le retirer de l’envoi, ou choisir d’autres fichiers.'
}

// ── Les régimes à choisir ──────────────────────────────────────────────────────────────────────────────────────────────
export const cleDeLOrganisme = (o: OrganismeAChoisir) => `${o.code}|${o.libelle}`

/** Tous les organismes de l'envoi dont le libellé ne dit pas le régime (une fois chacun, dans l'ordre de BOR2) : ils restent à
 *  l'écran, leur choix fait ou non, tant qu'ils sont dans l'envoi. */
export function organismesAChoisir(bordereaux: readonly BordereauLu[]): OrganismeAChoisir[] {
  const vus = new Map<string, OrganismeAChoisir>()
  for (const b of bordereaux) {
    const o = { code: b.organisme.code, libelle: b.organisme.libelle }
    if (regimeDuLibelle(o.libelle).etat === 'a_choisir' && !vus.has(cleDeLOrganisme(o))) vus.set(cleDeLOrganisme(o), o)
  }
  return [...vus.values()].sort((a, b) =>
    (a.code < b.code ? -1 : a.code > b.code ? 1 : a.libelle < b.libelle ? -1 : a.libelle > b.libelle ? 1 : 0))
}

/** Les choix qui partent à BOR2 : ceux d'un organisme encore dans l'envoi, et seulement d'un régime de la liste. Un choix
 *  laissé par un fichier retiré ne refuse pas l'envoi qui reste. */
export function choixRetenus(organismes: readonly OrganismeAChoisir[], choix: ReadonlyMap<string, number>): ChoixDuRegime[] {
  return organismes.flatMap((o) => {
    const regime = choix.get(cleDeLOrganisme(o))
    return regime !== undefined && regimeChoisi(regime) !== null ? [{ ...o, regime }] : []
  })
}

/** Le libellé d'un organisme à choisir, tel que l'en-tête du bordereau l'imprime. */
export const organismeAChoisirDit = (o: OrganismeAChoisir) => `${o.code} - ${o.libelle}`

/** Les régimes offerts au choix : la liste fermée de l'ANS, sous leur code sur deux chiffres. */
export const REGIMES_OFFERTS: readonly { code: number; libelle: string }[] =
  GRANDS_REGIMES.map((r) => ({ code: r.code, libelle: `${codeDuRegime(r)} — ${r.intitule}` }))

export function aideDuChoixDesRegimes(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Le libellé de ces organismes ne dit pas leur régime : choisis-le pour chacun. Rien n’est choisi pour toi.'
    : 'Le libellé de ces organismes ne dit pas leur régime : le choisir pour chacun. Rien n’est choisi d’avance.'
}

// ── Les agrégats, dits ─────────────────────────────────────────────────────────────────────────────────────────────────
export const montantDit = (centimes: number) => formatMoney(centimes / 100)
const pluriel = (n: number, mot: string, marque = 's') => `${n} ${mot}${n > 1 ? marque : ''}`

export const LIBELLES_DES_PARTS_DU_FACTURE: Readonly<Record<FactureAssuranceMaladie['part'], string>> = {
  obligatoire: 'Part obligatoire (caisse)',
  complementaire: 'Part complémentaire (mutuelle)',
}

/** Un total du facturé, sous la forme de la base : l'aperçu (BOR2) et la liste des imports se montrent par le même tableau. */
export type TotalDuFactureDit = Pick<FactureAssuranceMaladie,
  'date_creation_lot' | 'part' | 'regime' | 'caisse' | 'organisme_complementaire' | 'montant_centimes' | 'nombre_de_lots' | 'nombre_de_factures'>

export function totauxDeLApercu(agregats: readonly AgregatDuFacture[]): TotalDuFactureDit[] {
  return agregats.map((a) => ({
    date_creation_lot: a.date,
    part: a.part,
    regime: a.part === 'obligatoire' ? a.regime : null,
    caisse: a.part === 'obligatoire' ? a.caisse : null,
    organisme_complementaire: null,
    montant_centimes: a.montantCentimes,
    nombre_de_lots: a.nombreDeLots,
    nombre_de_factures: a.nombreDeFactures,
  }))
}

/** L'organisme d'un total : le régime (son intitulé et son code) et la caisse ; ou l'organisme complémentaire, dit ou non.
 *  Des codes, jamais une personne. */
export function organismeDuFactureDit(t: Pick<TotalDuFactureDit, 'part' | 'regime' | 'caisse' | 'organisme_complementaire'>): string {
  if (t.part === 'complementaire') {
    return t.organisme_complementaire === null ? 'organisme complémentaire non dit' : `organisme complémentaire ${t.organisme_complementaire}`
  }
  const regime = t.regime === null ? null : regimeChoisi(t.regime)
  const deRegime = t.regime === null ? 'régime non dit' : regime ? `${regime.intitule} (régime ${codeDuRegime(regime)})` : `régime ${t.regime}`
  return t.caisse === null ? deRegime : `${deRegime}, caisse ${String(t.caisse).padStart(3, '0')}`
}

/** Le nombre de factures d'un total : celui des lots qui y contribuent, un ordre de grandeur (BOR2, § 4.2). */
export const facturesDites = (n: number) => `≈ ${n}`

/** Le résumé de BOR2, en une phrase : ce que l'envoi porte, avant le clic. */
export function resumeDit(r: ResumeDuFacture): string {
  const periode = r.premiereDate === r.derniereDate
    ? `créé${r.nombreDeLots > 1 ? 's' : ''} le ${formatDate(r.premiereDate)}`
    : `créés du ${formatDate(r.premiereDate)} au ${formatDate(r.derniereDate)}`
  return `${pluriel(r.nombreDeLots, 'lot')} ${periode}, environ ${pluriel(r.nombreDeFactures, 'facture')} (un ordre de grandeur) : `
    + `part obligatoire ${montantDit(r.obligatoireCentimes)}, part complémentaire ${montantDit(r.complementaireCentimes)}, `
    + `soit ${montantDit(r.duCentimes)} facturés à l’assurance maladie.`
}

/** La raison d'un refus de BOR2, en phrase : la raison telle que le module la rend, et ce qu'elle emporte. */
export function refusDuFactureDit(raison: string, espace: EspaceVentes): string {
  const r = raison.charAt(0).toUpperCase() + raison.slice(1)
  return espace === 'client'
    ? `${r}. Rien ne peut partir : un bordereau douteux ne se lit pas à moitié. Vérifie tes fichiers.`
    : `${r}. Rien ne peut partir : un bordereau douteux ne se lit pas à moitié. Vérifier les fichiers.`
}

/**
 * La confirmation, qui NOMME ce qui part et ce qui reste dans les fichiers (conception 59, § 5.4) : les totaux, les lots et
 * leur période, les deux parts ; les numéros des lots, qui partent avec l'appel pour la seule empreinte que la base en garde ;
 * puis ce qui ne part pas.
 */
export function confirmationDeLImportDuFacture(r: ResumeDuFacture, nombreDeTotaux: number, espace: EspaceVentes): string {
  const partent = `${nombreDeTotaux} ${nombreDeTotaux > 1 ? 'totaux' : 'total'} du facturé `
    + `${nombreDeTotaux > 1 ? 'partent' : 'part'} en base — ${resumeDit(r).replace(/\.$/, '')}.`
  const numeros = ' Les numéros des lots partent avec l’appel, pour la seule empreinte que la base en garde sous une clé de '
    + 'ce dossier, afin qu’un lot ne s’importe pas deux fois ; aucun numéro n’est écrit en base.'
  const reste = espace === 'client'
    ? ' Rien d’autre ne part : les noms, les numéros d’assuré, les dates de soins, les numéros de facture et chaque ligne de '
      + 'tes bordereaux restent dans tes fichiers, sur ton ordinateur. Tout ou rien : si la base refuse un lot, rien ne s’importe.'
    : ' Rien d’autre ne part : les noms, les numéros d’assuré, les dates de soins, les numéros de facture et chaque ligne des '
      + 'bordereaux restent dans les fichiers, sur cet ordinateur. Tout ou rien : si la base refuse un lot, rien ne s’importe.'
  return partent + numeros + reste
}

/** Le refus que la base opposerait à l'envoi TEL QU'IL PARTIRA, pour le jour de Paris donné, ou nul : le corps de l'appel se
 *  compose ici, se juge par les mots de la base (`refusDeLImportDuFacture`), et n'est pas rendu. Le lot déjà importé et le lot
 *  d'un import restauré, la base seule les dit : le registre ne se lit par aucun rôle. */
export function refusAvantLEnvoiDuFacture(facture: Extract<FactureDesBordereaux, { etat: 'pret' }>, jour: string): string | null {
  return refusDeLImportDuFacture(corpsDeLImportDuFacture(facture), jour)
}

/** Le nombre de lots qui partent, sur le bouton. */
export const boutonDImportDit = (lots: number) => `Importer ${pluriel(lots, 'lot')}`

/** La phrase d'après l'import. Aucune consigne sur le fichier ni sur son support (BOR3RGPD-Q2 (B) : laissé au jugement du
 *  cabinet ; le client garde ses bordereaux comme il l'entend). */
export function phraseApresLImportDuFacture(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Importé. Seuls les chiffres ont été gardés — par date de création des lots, organisme et part, le montant et le nombre '
      + 'de lots et de factures — ; aucune ligne de tes bordereaux n’a quitté ton navigateur.'
    : 'Importé. Seuls les chiffres ont été gardés — par date de création des lots, organisme et part, le montant et le nombre '
      + 'de lots et de factures — ; aucune ligne des bordereaux n’a quitté ce navigateur.'
}

// ── Les textes de la section ───────────────────────────────────────────────────────────────────────────────────────────
export const PRESENTATION_DU_FACTURE_AU_CLIENT = 'Tes bordereaux de télétransmission (les PDF que ton logiciel imprime pour '
  + 'chaque lot) se lisent ici, dans ton navigateur : ils ne partent nulle part. Tu vois, avant d’importer, ce qu’ils facturent '
  + 'à l’assurance maladie par jour de création des lots, organisme et part ; seuls ces chiffres partent, jamais un nom ni une '
  + 'ligne. Ils servent à contrôler ce que l’assurance maladie te doit ; ils ne comptent pas dans tes recettes. Un bordereau ne '
  // La consigne aux clients (BOR6T-Q1 (A)) : une photo ne se lit pas ici, et déposée ailleurs, elle passe par la lecture.
  + 'se photographie pas : enregistre-le en PDF depuis ton logiciel de télétransmission, puis importe-le ici. Et il ne se dépose '
  + 'jamais dans « Mes pièces ».'

export const PRESENTATION_DU_FACTURE_AU_CABINET = 'Les bordereaux de télétransmission du praticien (les PDF que son logiciel '
  + 'imprime pour chaque lot) se lisent ici, dans ce navigateur : ils ne partent nulle part. L’aperçu donne le facturé par jour '
  + 'de création des lots, organisme et part ; seuls ces chiffres partent, au clic. Ils contrôlent ce que l’assurance maladie '
  + 'doit ; ils n’entrent ni dans la 2035, ni dans la CA3, ni dans le FEC.'

/** La consigne de BORQ8-Q1 (A) et de BOR3-RGPD (B), à l'écran du cabinet seul : sur place, ou de la main à la main, jamais par
 *  e-mail ; aucune consigne sur le support remis (BOR3RGPD-Q2 (B)). */
export const CONSIGNE_DU_FACTURE_AU_CABINET = 'Un bordereau porte les noms des patients du praticien : il se lit ici sur place, '
  + 'sur l’ordinateur du praticien, ou d’un fichier qu’il vous remet de la main à la main — jamais par e-mail. Cette remise est '
  + 'une transmission qu’il décide, sous son secret professionnel.'

export const VIDE_DU_FACTURE_DIT: Readonly<Record<EspaceVentes, string>> = {
  client: 'Tu n’as encore importé aucun bordereau de télétransmission.',
  cabinet: 'Aucun bordereau de télétransmission n’a encore été importé pour ce dossier.',
}

export const SANS_LA_CASE_BANQUE_DU_FACTURE = 'Ton accès ne porte plus « Banque » sur cette société : l’import de tes '
  + 'bordereaux de télétransmission ne s’affiche pas ici. Demande à ton cabinet d’ajouter « Banque » à ton accès.'

/** Les deux parts d'un import, en centimes, de ses seuls totaux. */
export function partsDeLImport(importId: string, totaux: readonly Pick<FactureAssuranceMaladie, 'import_id' | 'part' | 'montant_centimes'>[]):
  { obligatoire: number; complementaire: number } {
  let obligatoire = 0
  let complementaire = 0
  for (const t of totaux) {
    if (t.import_id !== importId) continue
    if (t.part === 'obligatoire') obligatoire += t.montant_centimes
    else complementaire += t.montant_centimes
  }
  return { obligatoire, complementaire }
}

/** La période des lots d'un import, en mots. */
export const periodeDesLotsDite = (imp: Pick<ImportFacturesAssuranceMaladie, 'premier_lot_le' | 'dernier_lot_le'>) =>
  imp.premier_lot_le === imp.dernier_lot_le
    ? `le ${formatDate(imp.premier_lot_le)}`
    : `du ${formatDate(imp.premier_lot_le)} au ${formatDate(imp.dernier_lot_le)}`

/** La confirmation d'un retrait, qui nomme ce qui part. */
export function confirmationDuRetraitDuFacture(
  imp: ImportFacturesAssuranceMaladie,
  totaux: readonly Pick<FactureAssuranceMaladie, 'import_id' | 'part' | 'montant_centimes'>[],
  espace: EspaceVentes,
): string {
  const { obligatoire, complementaire } = partsDeLImport(imp.id, totaux)
  return `Retirer l’import des lots créés ${periodeDesLotsDite(imp)} : ${pluriel(imp.nombre_de_lots, 'lot')}, environ `
    + `${pluriel(imp.nombre_de_factures, 'facture')}, ${montantDit(obligatoire)} de part obligatoire et ${montantDit(complementaire)} `
    + 'de part complémentaire partent avec lui, et l’empreinte de ses lots aussi. '
    + (espace === 'client'
      ? 'Tu pourras importer de nouveau les mêmes bordereaux.'
      : 'Les mêmes bordereaux pourront s’importer de nouveau.')
}
