import type { ANouveau, Categorie, EcritureBrouillon, JournalCode, ModeComptable, Piece } from './types'
import { idsMouvementsJustifiesParLeReleve, referenceDuReleve, type MouvementBancaire } from './affectationBanque'
import { libelleEcritureANouveau } from './aNouveaux'
import { libelleCompteTenu, libelleDuPlanComptable } from './comptes'
import { auxiliaireDuTiers } from './engagement'
import { dateAParis } from './format'
import type { LettrageDeLigne } from './lettrage'

// Génération du FEC (Fichier des Écritures Comptables) — format officiel imposé par l'article
// A47 A-1 du Livre des procédures fiscales, que tout logiciel de comptabilité sait importer sans
// ressaisie. Construit uniquement à partir des écritures brouillon déjà proposées/validées dans
// l'appli : si une pièce n'a pas encore de compte, ou n'est pas encore rapprochée en banque, elle
// n'apparaît simplement pas (ou apparaît déséquilibrée) — jamais devinée pour compléter le fichier.
//
// DEUX TEMPS, UNE SEULE LOGIQUE (ligne 26.6, étape d). La NUMÉROTATION décide de tout ce qu'une ligne
// porte hors de l'écriture elle-même — son journal, son numéro, sa pièce, le libellé de son compte, son
// compte auxiliaire —, puis la MISE EN FORME l'écrit. La validation d'un exercice envoie cette numérotation à
// `valider_exercice`, qui la fige sur les écritures ; le FEC d'un exercice validé se relit ensuite depuis ce
// qui a été figé (`numerotationValidee`), et non plus depuis les pièces et les catégories d'aujourd'hui. Les
// deux passent par la même mise en forme : le fichier d'avant la validation et celui d'après ne diffèrent que
// par ValidDate, qui devient la date de la validation — et par le LETTRAGE (EcritureLet, DateLet), qui ne se fige
// pas : il dit l'état des comptes de tiers au jour de l'export (lib/lettrage.ts). Une facture d'un exercice validé
// réglée l'exercice suivant se lettre ce jour-là, et le lettrage ne modifie rien de l'écriture : ni son compte, ni
// son montant, ni sa date.

// Les dix-huit champs du VII de l'article A47 A-1, ceux d'une comptabilité tenue selon le droit
// commercial. UN BNC EN COMPTABILITÉ DE TRÉSORERIE (VIII 7) en doit VINGT-DEUX : les mêmes, plus la
// date et le mode de règlement, la nature de l'opération et l'identification du client (DateRglt,
// ModeRglt, NatOp, IdClient). Ce fichier ne les écrit pas encore, pour aucun dossier — voir CLAUDE.md.
const ENTETES_FEC = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib',
  'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
  'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
]

export const LIBELLES_JOURNAUX: Readonly<Record<JournalCode, string>> = {
  AC: 'Achats',
  VE: 'Ventes',
  BQ: 'Banque',
  OD: 'Opérations diverses',
}

function yyyymmdd(iso: string): string {
  return iso.slice(0, 10).replaceAll('-', '')
}

// LA VIRGULE SÉPARE LA PARTIE ENTIÈRE DE LA PARTIE DÉCIMALE, et c'est l'article A47 A-1 qui le dit :
// « La virgule sépare la fraction entière de la partie décimale. Aucun séparateur de millier n'est
// accepté. » Le signe se place en tête. `toFixed` écrit un point : un outil d'import qui suit la norme
// rejette alors le fichier, ou ne lit pas les montants. Jusqu'au 28/09/2026, le FEC sortait ainsi.
function montant(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

// Le FEC est un fichier en colonnes séparées par des tabulations : une tabulation ou un saut de
// ligne dans un champ texte ne décale pas seulement une colonne, il coupe la ligne en deux et rend
// le fichier structurellement invalide pour l'outil d'import d'un contrôleur.
//
// Ce n'est pas théorique : les libellés viennent du tiers extrait par OCR (voir extract-piece), et
// un en-tête de facture sur plusieurs lignes ressort tel quel — "CAISSE\nD'EPARGNE\nCEPAC" est un
// cas réellement présent en base. Tout séparateur est donc remplacé par une espace, et les espaces
// multiples réduites, ce qui garde le libellé lisible sans casser le format.
function champFec(valeur: string): string {
  return valeur.replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

// Libellé du compte pour la colonne CompteLib — les comptes que l'application tient elle-même (TVA,
// banque, tiers, dotations et amortissements) d'abord, sinon celui de la catégorie qui porte ce
// compte_comptable, sinon celui du plan comptable pour un compte de bilan choisi par le cabinet (ligne 26.7,
// `libelleDuPlanComptable`), sinon le numéro de compte lui-même à défaut de mieux.
export function libelleCompte(compte: string, categories: Categorie[]): string {
  return libelleCompteTenu(compte)
    ?? (categories.find((c) => c.compte_comptable === compte)?.libelle || libelleDuPlanComptable(compte) || compte)
}

// Une ligne du FEC avant sa mise en forme : l'écriture, et ce que la numérotation décide pour elle. C'est
// exactement ce que `valider_exercice` reçoit et fige (`demandeDeValidation`, lib/validationExercice.ts).
export interface LigneFec {
  ecriture: EcritureBrouillon
  journal: JournalCode
  numero: number
  // La pièce de l'écriture : le justificatif, le relevé, le tableau d'amortissement ou le barème.
  pieceRef: string
  // AAAA-MM-JJ, comme les dates de la base.
  pieceDate: string
  compteLib: string
  compAuxNum: string | null
  compAuxLib: string | null
  // AAAA-MM-JJ : la date de l'écriture tant qu'elle est au brouillon, celle de sa validation ensuite.
  validDate: string
}

export interface ANouveauFec {
  aNouveau: ANouveau
  compteLib: string
  ecritureLib: string
  validDate: string
}

export interface NumerotationFec {
  aNouveaux: ANouveauFec[]
  // Dans l'ordre du fichier — voir `ordonnerLignes`.
  lignes: LigneFec[]
  // Les écritures que rien ne rattache : ni une pièce, ni un mouvement justifié par le relevé, ni un bien, ni
  // un véhicule — le reste d'une pièce supprimée, que `absenceFec` chiffre. Hors du fichier, et une écriture
  // qu'on ne peut pas numéroter empêche de valider son exercice.
  horsFec: EcritureBrouillon[]
}

// L'ORDRE DU FICHIER, le même avant et après la validation. Les écritures par date de leur plus ancienne
// ligne, puis date de pièce, journal et numéro ; les lignes d'une écriture par date, débit avant crédit, puis
// compte et identifiant. L'ordre des lignes ne dépend donc plus de celui de la lecture : deux exports du même
// brouillon rendent le même fichier, et le FEC relu depuis un exercice validé celui qu'on aurait exporté la
// veille de la validation.
function ordonnerLignes(lignes: LigneFec[]): LigneFec[] {
  const premiere = new Map<string, string>()
  for (const l of lignes) {
    const cle = `${l.journal}|${l.numero}`
    const actuelle = premiere.get(cle)
    if (actuelle === undefined || l.ecriture.date < actuelle) premiere.set(cle, l.ecriture.date)
  }
  return [...lignes].sort((a, b) => {
    const pa = premiere.get(`${a.journal}|${a.numero}`)!
    const pb = premiere.get(`${b.journal}|${b.numero}`)!
    return pa.localeCompare(pb) || a.pieceDate.localeCompare(b.pieceDate) || a.journal.localeCompare(b.journal)
      || a.numero - b.numero || a.ecriture.date.localeCompare(b.ecriture.date)
      || (a.ecriture.sens === b.ecriture.sens ? 0 : a.ecriture.sens === 'debit' ? -1 : 1)
      || a.ecriture.compte.localeCompare(b.ecriture.compte) || a.ecriture.id.localeCompare(b.ecriture.id)
  })
}

// LES À-NOUVEAUX OUVRENT LE FICHIER. Un FEC commence par les écritures d'ouverture : sans elles, le
// premier solde de chaque compte de bilan y paraît sortir de nulle part, et un contrôleur qui
// recalcule la banque depuis le fichier ne retrouve pas le relevé. `aNouveaux` porte ceux de
// l'exercice exporté — l'appelant filtre, comme pour les écritures. Une seule écriture, journal AN,
// numérotée à part des autres journaux ; sa pièce est la balance reprise.
//
// CompteLib reste celui de l'application pour un compte qu'elle tient (la banque, la TVA) : UN MÊME
// CompteNum NE PORTE QU'UN LIBELLÉ DANS TOUT LE FICHIER — à-nouveaux et écritures compris, et la validation
// le refuse autrement —, et les mouvements de la banque l'appellent « Banque ». Le numéro et le libellé de la
// balance d'origine passent dans EcritureLib.
function libellesDesComptes(categories: Categorie[], aNouveaux: readonly ANouveau[]): (compte: string) => string {
  const repris = new Map<string, string>()
  for (const a of [...aNouveaux].sort((x, y) => x.compte.localeCompare(y.compte) || x.id.localeCompare(y.id))) {
    const libelle = champFec(a.libelle)
    if (libelle && !repris.has(a.compte)) repris.set(a.compte, libelle)
  }
  return (compte) => champFec(libelleCompteTenu(compte) ?? repris.get(compte) ?? libelleCompte(compte, categories))
}

// Regroupe les écritures par pièce (une pièce = une écriture FEC, EcritureNum commun à toutes ses
// lignes), numérotées dans l'ordre chronologique à l'intérieur de leur journal — une vraie exigence
// du format, pas un détail cosmétique : un contrôleur qui importe un FEC aux EcritureNum non
// croissants dans un même journal le rejette.
//
// EN ENGAGEMENT (lib/engagement.ts), UNE PIÈCE FAIT PLUSIEURS ÉCRITURES : sa facture, au journal des
// achats ou des ventes, et chacun de ses règlements, au journal de BANQUE (BQ) — ce sont les lignes
// qui désignent leur mouvement. Les fondre en une seule écriture numéroterait sous un même
// EcritureNum des lignes datées de la facture et d'autres datées du paiement, dans le journal des
// achats, et la banque n'aurait pas de journal. Les lignes de 401 et de 411 y portent en plus le compte
// AUXILIAIRE du tiers (CompAuxNum, CompAuxLib), un seul libellé par numéro dans tout le fichier.
//
// UN MOUVEMENT JUSTIFIÉ PAR LE RELEVÉ (ligne 26.6, `mouvementJustifieParLeReleve`) — affecté à une
// catégorie, rapproché d'un emprunt ou d'une échéance de cotisation, ventilé sur plusieurs comptes, écrit
// sur un compte de bilan (ligne 26.7) ou classé en virement personnel — fait
// une écriture au journal de BANQUE, dans les deux modèles : sa pièce est le RELEVÉ qui le porte
// (PieceRef), à la date du mouvement (PieceDate). C'est ce qui manquait pour que le FEC porte chaque euro
// du relevé : un encaissement de l'Assurance maladie ou un prélèvement de l'exploitant n'y était nulle
// part.
//
// UNE DOTATION AUX AMORTISSEMENTS (lib/amortissements.ts) fait une écriture par bien et par exercice au
// journal des OPÉRATIONS DIVERSES (OD), au 31 décembre : sa pièce est le TABLEAU D'AMORTISSEMENT de
// l'exercice, qui la justifie (PieceRef). Sans elle, le 681100 de la 2035 n'était nulle part dans le
// fichier. LE FORFAIT KILOMÉTRIQUE (lib/forfaitKilometrique.ts) de même, une écriture par ligne du cadre 7,
// au même journal et à la même date : sa pièce est le BARÈME KILOMÉTRIQUE de l'exercice, appliqué au
// kilométrage déclaré. Les autres écritures sans pièce — le reste d'une pièce supprimée — restent dehors,
// et `absenceFec` les chiffre.
export function numeroterFec(
  ecritures: readonly EcritureBrouillon[], pieces: readonly Piece[], categories: Categorie[], aNouveaux: readonly ANouveau[],
  // Sans valeur par défaut : numéroté en trésorerie, le brouillon d'un dossier en engagement mettrait
  // ses règlements au journal des achats, sous le numéro de la facture.
  mode: ModeComptable,
  // Les lignes du relevé qui portent les mouvements affectés et les virements personnels — n'importe
  // quelles lignes, seules celles-là comptent. Sans valeur par défaut : les oublier sortirait du fichier
  // tous les encaissements sans bordereau, c'est-à-dire, pour un infirmier, presque toutes ses recettes.
  mouvements: readonly MouvementBancaire[],
): NumerotationFec {
  const pieceById = new Map(pieces.map((p) => [p.id, p]))
  const idsJustifies = idsMouvementsJustifiesParLeReleve(mouvements)
  const mouvementById = new Map(mouvements.map((m) => [m.id, m]))
  const libelleDu = libellesDesComptes(categories, aNouveaux)

  // La clé d'une écriture FEC : la pièce en trésorerie ; en engagement, la pièce et le mouvement d'un
  // règlement, la facture gardant la pièce seule ; le mouvement, pour un mouvement justifié par le relevé.
  //
  // ET, POUR UNE PIÈCE, SA DATE : UNE ÉCRITURE NE PORTE QU'UNE DATE (05/10/2026). EcritureDate est « la date de
  // comptabilisation de l'écriture comptable », une seule, et l'outil de la DGFiP le contrôle : une écriture dont les
  // lignes n'ont pas toutes la même date ressort parmi ses anomalies, « Différentes dates comptables » (Test Compta
  // Demat, SQL/ECRITURE.sql et SQL/VUES.sql — l'écran qu'il reproduit est celui des vérificateurs). En trésorerie, une
  // pièce payée en plusieurs fois porte une part par paiement, chacune à sa date (lib/rattachement.ts) : sous un seul
  // numéro, elle faisait une écriture à plusieurs dates. Elle en fait désormais une par date, équilibrée quand la pièce
  // est payée — la charge d'une date face à la banque de ce paiement, sa TVA complétant sa charge
  // (`lignesChargeProduitPourPiece`) ; une note de frais remboursée en partie, la part du virement à sa date et le
  // reste face au 108000 à la date de la note. En engagement, chaque écriture n'a déjà qu'une date ; la clé la porte
  // quand même, pour que l'invariant tienne par construction. `valider_exercice` refuse une écriture à deux dates.
  const groupes = new Map<string, EcritureBrouillon[]>()
  const horsFec: EcritureBrouillon[] = []
  for (const e of ecritures) {
    let cle: string
    if (e.piece_id) {
      const source = mode === 'engagement' && e.ligne_bancaire_id ? `${e.piece_id}|${e.ligne_bancaire_id}` : e.piece_id
      cle = `${source}|${e.date}`
    } else if (e.ligne_bancaire_id && idsJustifies.has(e.ligne_bancaire_id)) {
      cle = `releve|${e.ligne_bancaire_id}`
    } else if (e.immobilisation_id) {
      cle = `dotation|${e.immobilisation_id}|${e.date}`
    } else if (e.vehicule_id) {
      cle = `forfait|${e.vehicule_id}|${e.date}`
    } else {
      horsFec.push(e)
      continue
    }
    groupes.set(cle, [...(groupes.get(cle) ?? []), e])
  }

  // La plus ancienne des lignes d'une écriture — jamais `rows[0].date`, qui dépend de l'ordre de
  // retour de la requête.
  const plusAncienne = (rows: EcritureBrouillon[]) =>
    rows.reduce((date, e) => (e.date < date ? e.date : date), rows[0].date)

  // L'ORDRE DES EcritureNum SUIT LA DATE DE L'ÉCRITURE, PAS CELLE DE LA FACTURE. Un EcritureNum non
  // croissant dans un même journal fait rejeter le fichier ; or depuis que l'écriture d'une pièce
  // payée est datée à son PAIEMENT (lib/rattachement.ts), deux factures peuvent se régler dans
  // l'ordre inverse de leurs dates, et trier sur PieceDate numéroterait un paiement de mars avant un
  // paiement de février. C'est aussi ce que `valider_exercice` vérifie : dans un journal, la plus
  // ancienne ligne d'une écriture ne précède jamais celle de l'écriture d'avant.
  const entrees = [...groupes.entries()]
    .map(([cle, rows]) => {
      const pieceId = rows[0].piece_id
      const ordre = plusAncienne(rows)
      if (!pieceId && rows[0].immobilisation_id && !rows[0].ligne_bancaire_id) {
        return { cle, pieceId: null, rows, ordre, journal: 'OD' as const, pieceDate: rows[0].date,
          pieceRef: `Tableau d'amortissement ${rows[0].date.slice(0, 4)}` }
      }
      if (!pieceId && rows[0].vehicule_id && !rows[0].ligne_bancaire_id) {
        return { cle, pieceId: null, rows, ordre, journal: 'OD' as const, pieceDate: rows[0].date,
          pieceRef: `Barème kilométrique ${rows[0].date.slice(0, 4)}` }
      }
      if (!pieceId) {
        const mouvement = mouvementById.get(rows[0].ligne_bancaire_id!)!
        return { cle, pieceId: null, rows, ordre, journal: 'BQ' as const, pieceDate: mouvement.date,
          pieceRef: referenceDuReleve(mouvement) }
      }
      const piece = pieceById.get(pieceId)
      // Un règlement d'engagement : ses lignes désignent leur mouvement, celles de la facture aucun — la clé les sépare.
      const reglement = mode === 'engagement' && Boolean(rows[0].ligne_bancaire_id)
      // Date de la pièce (PieceDate) : celle du justificatif lui-même, avec pour repli la plus ancienne de
      // ses lignes. Sa référence : le nom du fichier, sinon le début de son identifiant — jamais vide, la
      // validation refuse une ligne sans pièce.
      return {
        cle, pieceId, rows, ordre,
        journal: reglement ? 'BQ' as const : piece?.type_piece === 'vente' ? 'VE' as const : 'AC' as const,
        pieceDate: piece?.date_piece ?? ordre,
        pieceRef: champFec(piece?.nom_fichier ?? '') || pieceId.slice(0, 8),
      }
    })
    // À date égale, on départage sur la facture puis sur la clé, pour que deux exports successifs du
    // même brouillon produisent exactement le même fichier.
    .sort((a, b) => a.ordre.localeCompare(b.ordre) || a.pieceDate.localeCompare(b.pieceDate) || a.cle.localeCompare(b.cle))

  const compteurs: Partial<Record<JournalCode, number>> = {}
  const lignes: LigneFec[] = []
  for (const { pieceId, rows, journal, pieceDate, pieceRef } of entrees) {
    const numero = (compteurs[journal] ?? 0) + 1
    compteurs[journal] = numero
    const piece = pieceId ? pieceById.get(pieceId) : undefined
    for (const e of rows) {
      // Une pièce absente du jeu fourni n'a pas de tiers qu'on puisse lire : son auxiliaire est le
      // compte « divers », plutôt qu'une clé tirée d'un libellé qui peut n'être qu'un nom de fichier.
      // Un mouvement justifié par le relevé n'a pas de compte AUXILIAIRE : son écriture va de la catégorie,
      // ou du compte du dirigeant, à la banque — l'auxiliaire ne sert qu'aux 401 et 411 d'une pièce.
      const auxiliaire = pieceId ? auxiliaireDuTiers(piece ?? { tiers: null }, e.compte) : null
      lignes.push({
        ecriture: e, journal, numero, pieceRef: champFec(pieceRef), pieceDate,
        compteLib: libelleDu(e.compte),
        compAuxNum: auxiliaire ? champFec(auxiliaire.num) : null,
        compAuxLib: auxiliaire ? champFec(auxiliaire.lib) : null,
        validDate: e.date,
      })
    }
  }

  // Le libellé de chaque compte auxiliaire : le premier rencontré dans l'ordre du fichier, pour qu'un
  // même CompAuxNum ne porte qu'un CompAuxLib — l'OCR n'écrit pas deux fois le nom d'un fournisseur
  // de la même façon. La validation refuse un auxiliaire qui en porte deux.
  const ordonnees = ordonnerLignes(lignes)
  const libellesAuxiliaires = new Map<string, string>()
  for (const l of ordonnees) {
    if (l.compAuxNum === null) continue
    const premier = libellesAuxiliaires.get(l.compAuxNum)
    if (premier === undefined) libellesAuxiliaires.set(l.compAuxNum, l.compAuxLib!)
    else l.compAuxLib = premier
  }

  return {
    aNouveaux: [...aNouveaux]
      .sort((a, b) => a.compte.localeCompare(b.compte) || a.id.localeCompare(b.id))
      .map((a) => ({ aNouveau: a, compteLib: libelleDu(a.compte), ecritureLib: champFec(libelleEcritureANouveau(a)), validDate: a.date })),
    lignes: ordonnees,
    horsFec,
  }
}

// LE FEC D'UN EXERCICE VALIDÉ SE RELIT DEPUIS CE QUI A ÉTÉ FIGÉ. Chaque écriture validée porte son journal, son
// numéro, sa pièce, le libellé de son compte et son compte auxiliaire, tels que `numeroterFec` les avait
// décidés le jour de la validation ; les à-nouveaux de l'exercice portent les libellés de leur compte et de leur
// écriture. Rien n'est relu des pièces ni des catégories d'aujourd'hui : une catégorie renommée ou un tiers
// corrigé ne changent plus le fichier. ValidDate est la date de la validation, à Paris — la base la date ainsi,
// et deux exports doivent rendre le même fichier où que soit le poste.
//
// Une écriture qui ne porte pas ce qu'une écriture validée porte n'est pas numérotée : elle part dans
// `horsFec`, au lieu d'être imprimée avec des champs vides. Elle ne peut pas exister — la base refuse la
// validation tant qu'une écriture de l'exercice reste proposée —, et c'est pourquoi elle se voit plutôt que
// de se cacher.
export function numerotationValidee(
  ecritures: readonly EcritureBrouillon[], aNouveaux: readonly ANouveau[],
  // L'instant de la validation de l'exercice (`exercices_valides.valide_le`), ValidDate des à-nouveaux.
  valideLe: string,
): NumerotationFec {
  const lignes: LigneFec[] = []
  const horsFec: EcritureBrouillon[] = []
  for (const e of ecritures) {
    if (e.statut !== 'validee' || !e.valide_le || !e.journal_code || !e.numero_ecriture || !e.piece_ref
      || !e.piece_date || !e.compte_lib) {
      horsFec.push(e)
      continue
    }
    lignes.push({
      ecriture: e, journal: e.journal_code, numero: e.numero_ecriture, pieceRef: e.piece_ref, pieceDate: e.piece_date,
      compteLib: e.compte_lib, compAuxNum: e.comp_aux_num, compAuxLib: e.comp_aux_lib, validDate: dateAParis(e.valide_le),
    })
  }
  const validDate = dateAParis(valideLe)
  return {
    aNouveaux: [...aNouveaux]
      .sort((a, b) => a.compte.localeCompare(b.compte) || a.id.localeCompare(b.id))
      .map((a) => ({
        aNouveau: a,
        compteLib: a.compte_lib ?? champFec(libelleCompteTenu(a.compte) ?? (a.libelle || libelleDuPlanComptable(a.compte) || a.compte)),
        ecritureLib: a.ecriture_lib ?? champFec(libelleEcritureANouveau(a)),
        validDate,
      })),
    lignes: ordonnerLignes(lignes),
    horsFec,
  }
}

// La mise en forme, commune aux deux : en-tête, à-nouveaux, puis les écritures dans l'ordre de la
// numérotation, en tabulations et fins de ligne CRLF.
//
// LE LETTRAGE (EcritureLet, DateLet) vient de `lettrages` (lib/lettrage.ts), calculé sur TOUT le brouillon du dossier
// et non sur l'exercice exporté : une facture de décembre réglée en janvier porte le même code dans les deux fichiers.
// Une ligne que rien ne lettre laisse les deux champs à blanc, ce que la norme prévoit (« à blanc si non utilisé »).
export function formaterFec(
  numerotation: NumerotationFec,
  // Sans valeur par défaut : oublié, le FEC d'un dossier en engagement sortirait sans aucun lettrage, et rien ne le
  // dirait. Un dossier en trésorerie passe une table vide — rien ne s'y lettre.
  lettrage: ReadonlyMap<string, LettrageDeLigne>,
): string {
  const lignes: string[] = [ENTETES_FEC.join('\t')]
  for (const { aNouveau: a, compteLib, ecritureLib, validDate } of numerotation.aNouveaux) {
    lignes.push([
      'AN',
      'À-nouveaux',
      'AN00001',
      yyyymmdd(a.date),
      champFec(a.compte),
      champFec(compteLib),
      '', '',
      champFec(a.source_nom),
      yyyymmdd(a.date),
      champFec(ecritureLib),
      a.sens === 'debit' ? montant(a.montant) : montant(0),
      a.sens === 'credit' ? montant(a.montant) : montant(0),
      '', '',
      yyyymmdd(validDate),
      '', '',
    ].join('\t'))
  }
  for (const l of numerotation.lignes) {
    const e = l.ecriture
    lignes.push([
      l.journal,
      LIBELLES_JOURNAUX[l.journal],
      `${l.journal}${String(l.numero).padStart(5, '0')}`,
      yyyymmdd(e.date),
      champFec(e.compte),
      champFec(l.compteLib),
      l.compAuxNum ? champFec(l.compAuxNum) : '',
      l.compAuxLib ? champFec(l.compAuxLib) : '',
      champFec(l.pieceRef),
      yyyymmdd(l.pieceDate),
      champFec(e.libelle),
      e.sens === 'debit' ? montant(e.montant) : montant(0),
      e.sens === 'credit' ? montant(e.montant) : montant(0),
      lettrage.get(e.id)?.code ?? '',
      lettrage.has(e.id) ? yyyymmdd(lettrage.get(e.id)!.date) : '',
      yyyymmdd(l.validDate),
      '', '',
    ].join('\t'))
  }
  return lignes.join('\r\n')
}

export function genererFec(
  ecritures: EcritureBrouillon[], pieces: Piece[], categories: Categorie[], aNouveaux: readonly ANouveau[],
  mode: ModeComptable, mouvements: readonly MouvementBancaire[], lettrage: ReadonlyMap<string, LettrageDeLigne>,
): string {
  return formaterFec(numeroterFec(ecritures, pieces, categories, aNouveaux, mode, mouvements), lettrage)
}

// SirenFECAAAAMMJJ.txt — nom de fichier imposé par le format (AAAAMMJJ = date de clôture de
// l'exercice couvert). Le SIRET saisi sur le dossier commence par le SIREN (9 premiers chiffres) ;
// à défaut de SIRET renseigné, un repère à corriger avant transmission plutôt qu'un fichier qui a
// l'air valide sans l'être.
export function nomFichierFec(siret: string | null, anneeCloture: number): string {
  const siren = siret ? siret.replace(/\D/g, '').slice(0, 9) : 'A_COMPLETER'
  return `${siren}FEC${anneeCloture}1231.txt`
}

export function telechargerTexte(nomFichier: string, contenu: string) {
  const blob = new Blob([contenu], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
