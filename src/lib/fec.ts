import type { ANouveau, Categorie, EcritureBrouillon, ModeComptable, Piece } from './types'
import { idsMouvementsJustifiesParLeReleve, referenceDuReleve, type MouvementBancaire } from './affectationBanque'
import { libelleEcritureANouveau } from './aNouveaux'
import { LIBELLES_COMPTES } from './comptes'
import { auxiliaireDuTiers } from './engagement'

// Génération du FEC (Fichier des Écritures Comptables) — format officiel imposé par l'article
// A47 A-1 du Livre des procédures fiscales, que tout logiciel de comptabilité sait importer sans
// ressaisie. Construit uniquement à partir des écritures brouillon déjà proposées/validées dans
// l'appli : si une pièce n'a pas encore de compte, ou n'est pas encore rapprochée en banque, elle
// n'apparaît simplement pas (ou apparaît déséquilibrée) — jamais devinée pour compléter le fichier.

// Les dix-huit champs du VII de l'article A47 A-1, ceux d'une comptabilité tenue selon le droit
// commercial. UN BNC EN COMPTABILITÉ DE TRÉSORERIE (VIII 7) en doit VINGT-DEUX : les mêmes, plus la
// date et le mode de règlement, la nature de l'opération et l'identification du client (DateRglt,
// ModeRglt, NatOp, IdClient). Ce fichier ne les écrit pas encore, pour aucun dossier — voir CLAUDE.md.
const ENTETES_FEC = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib',
  'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
  'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
]

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
// banque, tiers) d'abord, sinon celui de la catégorie qui porte ce compte_comptable, sinon le numéro de
// compte lui-même à défaut de mieux.
export function libelleCompte(compte: string, categories: Categorie[]): string {
  if (LIBELLES_COMPTES[compte]) return LIBELLES_COMPTES[compte]
  return categories.find((c) => c.compte_comptable === compte)?.libelle ?? compte
}

// LES À-NOUVEAUX OUVRENT LE FICHIER. Un FEC commence par les écritures d'ouverture : sans elles, le
// premier solde de chaque compte de bilan y paraît sortir de nulle part, et un contrôleur qui
// recalcule la banque depuis le fichier ne retrouve pas le relevé. `aNouveaux` porte ceux de
// l'exercice exporté — l'appelant filtre, comme pour les écritures. Une seule écriture, journal AN,
// numérotée à part des autres journaux ; sa pièce est la balance reprise.
//
// CompteLib reste celui de l'application pour un compte qu'elle tient (la banque, la TVA) : un même
// CompteNum ne porte qu'un libellé dans tout le fichier, et les mouvements de la banque l'appellent
// « Banque ». Le numéro et le libellé de la balance d'origine passent dans EcritureLib.
function lignesANouveaux(aNouveaux: readonly ANouveau[]): string[] {
  return [...aNouveaux]
    .sort((a, b) => a.compte.localeCompare(b.compte) || a.id.localeCompare(b.id))
    .map((a) => [
      'AN',
      'À-nouveaux',
      'AN00001',
      yyyymmdd(a.date),
      champFec(a.compte),
      champFec(LIBELLES_COMPTES[a.compte] ?? (a.libelle || a.compte)),
      '', '',
      champFec(a.source_nom),
      yyyymmdd(a.date),
      champFec(libelleEcritureANouveau(a)),
      a.sens === 'debit' ? montant(a.montant) : montant(0),
      a.sens === 'credit' ? montant(a.montant) : montant(0),
      '', '',
      yyyymmdd(a.date),
      '', '',
    ].join('\t'))
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
// catégorie, rapproché d'un emprunt ou d'une échéance de cotisation, ventilé sur plusieurs comptes ou
// classé en virement personnel — fait
// une écriture au journal de BANQUE, dans les deux modèles : sa pièce est le RELEVÉ qui le porte
// (PieceRef), à la date du mouvement (PieceDate). C'est ce qui manquait pour que le FEC porte chaque euro
// du relevé : un encaissement de l'Assurance maladie ou un prélèvement de l'exploitant n'y était nulle
// part. Les autres écritures sans pièce — le reste d'une pièce supprimée — restent dehors, et `absenceFec`
// les chiffre.
export function genererFec(
  ecritures: EcritureBrouillon[], pieces: Piece[], categories: Categorie[], aNouveaux: readonly ANouveau[],
  // Sans valeur par défaut : exporté en trésorerie, le brouillon d'un dossier en engagement mettrait
  // ses règlements au journal des achats, sous le numéro de la facture.
  mode: ModeComptable,
  // Les lignes du relevé qui portent les mouvements affectés et les virements personnels — n'importe
  // quelles lignes, seules celles-là comptent. Sans valeur par défaut : les oublier sortirait du fichier
  // tous les encaissements sans bordereau, c'est-à-dire, pour un infirmier, presque toutes ses recettes.
  mouvements: readonly MouvementBancaire[],
): string {
  const pieceById = new Map(pieces.map((p) => [p.id, p]))
  const idsJustifies = idsMouvementsJustifiesParLeReleve(mouvements)
  const mouvementById = new Map(mouvements.map((m) => [m.id, m]))

  // La clé d'une écriture FEC : la pièce en trésorerie ; en engagement, la pièce et le mouvement d'un
  // règlement, la facture gardant la pièce seule ; le mouvement, pour un mouvement justifié par le relevé.
  const groupes = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    let cle: string
    if (e.piece_id) {
      cle = mode === 'engagement' && e.ligne_bancaire_id ? `${e.piece_id}|${e.ligne_bancaire_id}` : e.piece_id
    } else if (e.ligne_bancaire_id && idsJustifies.has(e.ligne_bancaire_id)) {
      cle = `releve|${e.ligne_bancaire_id}`
    } else continue
    groupes.set(cle, [...(groupes.get(cle) ?? []), e])
  }

  // La plus ancienne des lignes d'une écriture — jamais `rows[0].date`, qui dépend de l'ordre de
  // retour de la requête.
  const plusAncienne = (rows: EcritureBrouillon[]) =>
    rows.reduce((date, e) => (e.date < date ? e.date : date), rows[0].date)

  // Date de la pièce (PieceDate) : celle du justificatif lui-même, avec pour repli la plus ancienne de
  // ses lignes.
  function dateDePiece(pieceId: string, rows: EcritureBrouillon[]): string {
    return pieceById.get(pieceId)?.date_piece ?? plusAncienne(rows)
  }

  // L'ORDRE DES EcritureNum SUIT LA DATE DE L'ÉCRITURE, PAS CELLE DE LA FACTURE. Un EcritureNum non
  // croissant dans un même journal fait rejeter le fichier ; or depuis que l'écriture d'une pièce
  // payée est datée à son PAIEMENT (lib/rattachement.ts), deux factures peuvent se régler dans
  // l'ordre inverse de leurs dates, et trier sur PieceDate numéroterait un paiement de mars avant un
  // paiement de février.
  const entrees = [...groupes.entries()]
    .map(([cle, rows]) => {
      const pieceId = rows[0].piece_id
      if (!pieceId) {
        const mouvement = mouvementById.get(rows[0].ligne_bancaire_id!)!
        return {
          cle, pieceId: null, rows, reglement: true, date: mouvement.date, ordre: plusAncienne(rows),
          pieceRef: referenceDuReleve(mouvement),
        }
      }
      return {
        cle, pieceId, rows, reglement: cle !== pieceId, date: dateDePiece(pieceId, rows), ordre: plusAncienne(rows),
        pieceRef: null,
      }
    })
    // À date égale, on départage sur la facture puis sur la clé, pour que deux exports successifs du
    // même brouillon produisent exactement le même fichier.
    .sort((a, b) => a.ordre.localeCompare(b.ordre) || a.date.localeCompare(b.date) || a.cle.localeCompare(b.cle))

  const compteurs: Record<string, number> = {}
  const lignes: string[] = [ENTETES_FEC.join('\t'), ...lignesANouveaux(aNouveaux)]
  // Le libellé de chaque compte auxiliaire : le premier rencontré dans l'ordre du fichier, pour qu'un
  // même CompAuxNum ne porte qu'un CompAuxLib — l'OCR n'écrit pas deux fois le nom d'un fournisseur
  // de la même façon.
  const libellesAuxiliaires = new Map<string, string>()

  for (const { pieceId, rows, date, reglement, pieceRef: refReleve } of entrees) {
    const piece = pieceId ? pieceById.get(pieceId) : undefined
    const journalCode = reglement ? 'BQ' : piece?.type_piece === 'vente' ? 'VE' : 'AC'
    const journalLib = reglement ? 'Banque' : piece?.type_piece === 'vente' ? 'Ventes' : 'Achats'
    compteurs[journalCode] = (compteurs[journalCode] ?? 0) + 1
    const ecritureNum = `${journalCode}${String(compteurs[journalCode]).padStart(5, '0')}`
    const pieceRef = refReleve ?? piece?.nom_fichier ?? pieceId!.slice(0, 8)
    const pieceDate = yyyymmdd(date)

    for (const e of rows) {
      // Une pièce absente du jeu fourni n'a pas de tiers qu'on puisse lire : son auxiliaire est le
      // compte « divers », plutôt qu'une clé tirée d'un libellé qui peut n'être qu'un nom de fichier.
      // Un mouvement justifié par le relevé n'a pas de compte AUXILIAIRE : son écriture va de la catégorie,
      // ou du compte du dirigeant, à la banque — l'auxiliaire ne sert qu'aux 401 et 411 d'une pièce.
      const auxiliaire = pieceId ? auxiliaireDuTiers(piece ?? { tiers: null }, e.compte) : null
      if (auxiliaire && !libellesAuxiliaires.has(auxiliaire.num)) libellesAuxiliaires.set(auxiliaire.num, auxiliaire.lib)
      lignes.push([
        journalCode,
        journalLib,
        ecritureNum,
        yyyymmdd(e.date),
        champFec(e.compte),
        champFec(libelleCompte(e.compte, categories)),
        auxiliaire ? champFec(auxiliaire.num) : '',
        auxiliaire ? champFec(libellesAuxiliaires.get(auxiliaire.num)!) : '',
        champFec(pieceRef),
        pieceDate,
        champFec(e.libelle),
        e.sens === 'debit' ? montant(e.montant) : montant(0),
        e.sens === 'credit' ? montant(e.montant) : montant(0),
        '', '',
        yyyymmdd(e.date),
        '', '',
      ].join('\t'))
    }
  }

  return lignes.join('\r\n')
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
