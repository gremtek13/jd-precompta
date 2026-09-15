import type { Categorie, EcritureBrouillon, Piece } from './types'
import { COMPTE_BANQUE, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE } from './ecritures'

// Génération du FEC (Fichier des Écritures Comptables) — format officiel imposé par l'article
// A47 A-1 du Livre des procédures fiscales, que tout logiciel de comptabilité sait importer sans
// ressaisie. Construit uniquement à partir des écritures brouillon déjà proposées/validées dans
// l'appli : si une pièce n'a pas encore de compte, ou n'est pas encore rapprochée en banque, elle
// n'apparaît simplement pas (ou apparaît déséquilibrée) — jamais devinée pour compléter le fichier.

const ENTETES_FEC = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib',
  'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
  'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
]

const LIBELLES_COMPTES_FIXES: Record<string, string> = {
  [COMPTE_TVA_DEDUCTIBLE]: 'TVA déductible',
  [COMPTE_TVA_COLLECTEE]: 'TVA collectée',
  [COMPTE_BANQUE]: 'Banque',
}

function yyyymmdd(iso: string): string {
  return iso.slice(0, 10).replaceAll('-', '')
}

function montant(n: number): string {
  return n.toFixed(2)
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

// Libellé du compte pour la colonne CompteLib — les comptes fixes (TVA, banque) d'abord, sinon celui
// de la catégorie qui porte ce compte_comptable, sinon le numéro de compte lui-même à défaut de mieux.
export function libelleCompte(compte: string, categories: Categorie[]): string {
  if (LIBELLES_COMPTES_FIXES[compte]) return LIBELLES_COMPTES_FIXES[compte]
  return categories.find((c) => c.compte_comptable === compte)?.libelle ?? compte
}

// Regroupe les écritures par pièce (une pièce = une écriture FEC, EcritureNum commun à toutes ses
// lignes), numérotées dans l'ordre chronologique à l'intérieur de leur journal — une vraie exigence
// du format, pas un détail cosmétique : un contrôleur qui importe un FEC aux EcritureNum non
// croissants dans un même journal le rejette.
export function genererFec(ecritures: EcritureBrouillon[], pieces: Piece[], categories: Categorie[]): string {
  const pieceById = new Map(pieces.map((p) => [p.id, p]))

  const groupes = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    if (!e.piece_id) continue
    groupes.set(e.piece_id, [...(groupes.get(e.piece_id) ?? []), e])
  }

  // Date de la pièce : celle du justificatif lui-même, avec pour repli la plus ancienne de ses
  // lignes — jamais `rows[0].date`, qui dépend de l'ordre de retour de la requête et pourrait aussi
  // bien être la date de paiement portée par la contrepartie banque que celle de la facture. Elle
  // sert aussi de clé de tri : un EcritureNum non croissant dans un même journal fait rejeter le
  // fichier, il ne doit donc pas dépendre d'un ordre non garanti.
  function dateDePiece(pieceId: string, rows: EcritureBrouillon[]): string {
    const piece = pieceById.get(pieceId)
    if (piece?.date_piece) return piece.date_piece
    return rows.reduce((plusAncienne, e) => (e.date < plusAncienne ? e.date : plusAncienne), rows[0].date)
  }

  const entrees = [...groupes.entries()]
    .map(([pieceId, rows]) => ({ pieceId, rows, date: dateDePiece(pieceId, rows) }))
    // À date égale, on départage sur l'identifiant pour que deux exports successifs du même
    // brouillon produisent exactement le même fichier.
    .sort((a, b) => a.date.localeCompare(b.date) || a.pieceId.localeCompare(b.pieceId))

  const compteurs: Record<string, number> = {}
  const lignes: string[] = [ENTETES_FEC.join('\t')]

  for (const { pieceId, rows, date } of entrees) {
    const piece = pieceById.get(pieceId)
    const journalCode = piece?.type_piece === 'vente' ? 'VE' : 'AC'
    const journalLib = piece?.type_piece === 'vente' ? 'Ventes' : 'Achats'
    compteurs[journalCode] = (compteurs[journalCode] ?? 0) + 1
    const ecritureNum = `${journalCode}${String(compteurs[journalCode]).padStart(5, '0')}`
    const pieceRef = piece?.nom_fichier ?? pieceId.slice(0, 8)
    const pieceDate = yyyymmdd(date)

    for (const e of rows) {
      lignes.push([
        journalCode,
        journalLib,
        ecritureNum,
        yyyymmdd(e.date),
        champFec(e.compte),
        champFec(libelleCompte(e.compte, categories)),
        '', '',
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
