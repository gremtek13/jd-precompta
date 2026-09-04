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

  const entrees = [...groupes.entries()].sort((a, b) => a[1][0].date.localeCompare(b[1][0].date))
  const compteurs: Record<string, number> = {}
  const lignes: string[] = [ENTETES_FEC.join('\t')]

  for (const [pieceId, rows] of entrees) {
    const piece = pieceById.get(pieceId)
    const journalCode = piece?.type_piece === 'vente' ? 'VE' : 'AC'
    const journalLib = piece?.type_piece === 'vente' ? 'Ventes' : 'Achats'
    compteurs[journalCode] = (compteurs[journalCode] ?? 0) + 1
    const ecritureNum = `${journalCode}${String(compteurs[journalCode]).padStart(5, '0')}`
    const pieceRef = piece?.nom_fichier ?? pieceId.slice(0, 8)
    const pieceDate = yyyymmdd(rows[0].date)

    for (const e of rows) {
      lignes.push([
        journalCode,
        journalLib,
        ecritureNum,
        yyyymmdd(e.date),
        e.compte,
        libelleCompte(e.compte, categories),
        '', '',
        pieceRef,
        pieceDate,
        e.libelle,
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
