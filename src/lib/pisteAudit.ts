import { COMPTE_BANQUE } from './comptes'
import type { EcritureBrouillon, LigneBancaire, Piece } from './types'

// Piste d'audit fiable — les ruptures de la chaîne « écriture → justificatif → opération réelle ».
//
// POURQUOI CE MODULE EXISTE, alors que `analyserEcritures` contrôle déjà le brouillon. Ses trois
// contrôles partent tous de la PIÈCE : ils regroupent les écritures par `piece_id`, et la toute
// première ligne de la boucle est `if (!e.piece_id) continue`. Une écriture sans pièce n'a donc pas
// de groupe, et devient invisible aux trois à la fois. C'est mot pour mot le défaut de
// `categoriesSansCompte` face à une pièce dont la catégorie est nulle (voir controles.ts) : un
// contrôle qui part d'un côté de la relation ne peut pas voir ce qui manque de l'autre.
//
// CE QUE ÇA COÛTE, mesuré en production le 19/09/2026. Une écriture de 199,99 € (compte 606100,
// « BOULANGER MARSEILLE ») n'a plus de `piece_id` : deux pièces du même fournisseur existaient, une
// a été supprimée, et Postgres a mis le lien à NULL — les deux clés étrangères d'`ecritures_brouillon`
// sont en `ON DELETE SET NULL`. Résultat, cette charge de 199,99 € :
//   - est comptée dans la Balance des comptes (`calculerBalance` regroupe par COMPTE, pas par pièce) ;
//   - est ABSENTE du FEC (`genererFec` fait le même `if (!e.piece_id) continue`, et c'est le bon
//     choix : inventer une référence de pièce serait pire) ;
//   - n'est signalée par AUCUN des trois contrôles d'intégrité.
// La balance et le fichier fiscal ne disent donc pas le même résultat, et rien ne l'annonce. C'est
// précisément ce qu'un contrôleur cherche en premier : montrez-moi la pièce de cette charge.
//
// Pur, sans accès à la base : ne prend que des lignes déjà chargées (voir l'en-tête de comptes.ts
// sur la raison pour laquelle les constantes PCG vivent à part).

export type MotifRupture =
  // L'écriture ne désigne aucun justificatif. Elle reste dans la balance et sort du FEC.
  | 'sans_justificatif'
  // L'écriture de contrepartie annonce un mouvement bancaire mais n'en nomme aucun. Elle ne peut
  // venir que d'une ligne bancaire supprimée (un relevé réimporté, par exemple) : l'insertion, elle,
  // pose toujours `ligne_bancaire_id` (voir contrepartieBanque.ts).
  | 'sans_mouvement'

export interface RuptureAudit {
  ecriture: EcritureBrouillon
  motif: MotifRupture
}

// Une écriture peut porter les deux ruptures à la fois (contrepartie banque dont la pièce ET la
// ligne ont disparu) : elle est alors rendue deux fois, une par motif. Les fusionner obligerait
// l'écran à traiter un cas composite pour n'économiser qu'une ligne.
export function rupturesPisteAudit(ecritures: EcritureBrouillon[]): RuptureAudit[] {
  const ruptures: RuptureAudit[] = []
  for (const ecriture of ecritures) {
    if (!ecriture.piece_id) ruptures.push({ ecriture, motif: 'sans_justificatif' })
    if (ecriture.compte === COMPTE_BANQUE && !ecriture.ligne_bancaire_id) {
      ruptures.push({ ecriture, motif: 'sans_mouvement' })
    }
  }
  return ruptures
}

// DÉLIBÉRÉMENT ABSENT : « l'écriture désigne une pièce qui n'est pas dans le jeu fourni ».
// L'appelant le plus naturel (EcrituresTab) ne charge que les pièces VALIDÉES ; une pièce repassée
// « à valider » ferait donc crier au loup sur un artefact de filtrage, pas sur une rupture. Un
// avertissement qui se trompe souvent finit par ne plus être lu — et c'est celui-là qu'on ne peut
// pas se permettre de ne plus lire. Le seul signal retenu ici est `piece_id` nul, qui ne dépend
// d'aucun jeu de données à côté.

export interface AbsenceFec {
  nb: number
  debit: number
  credit: number
}

// Ce que la Balance des comptes affiche et que le FEC ne contiendra pas — à dire AVANT de
// télécharger le fichier, pas après. Le format FEC est rigide : impossible d'y écrire une feuille
// « lignes manquantes » comme le pack Excel le fait pour ses pièces. Le seul endroit où ce livrable
// incomplet peut se déclarer est donc l'écran qui l'engendre.
export function absenceFec(ecritures: EcritureBrouillon[]): AbsenceFec {
  const horsFec = ecritures.filter((e) => !e.piece_id)
  return {
    nb: horsFec.length,
    debit: horsFec.filter((e) => e.sens === 'debit').reduce((somme, e) => somme + e.montant, 0),
    credit: horsFec.filter((e) => e.sens === 'credit').reduce((somme, e) => somme + e.montant, 0),
  }
}

// ═══ L'export de la piste ═══════════════════════════════════════════════════════════════════════
//
// Ce que la loi demande n'est pas un contrôle mais une PRODUCTION : depuis chaque écriture, remonter
// au justificatif et à l'opération réelle, et redescendre dans l'autre sens, de façon continue et
// chronologique. Les trois maillons existaient déjà en base ; ce qui manquait était de pouvoir les
// poser sur une table, ce qu'un vérificateur demande à voir.
//
// UNE SEULE TABLE, LES DEUX SENS DEDANS. Une ligne par écriture, plus une ligne par justificatif
// validé qu'aucune écriture ne cite. Tout tient donc dans un seul tableau chronologique, et chaque
// trou se lit dans la même colonne `manque` — plutôt qu'en deux listes que personne ne recoupe.
// C'est la même discipline que la feuille « Pièces manquantes » d'un pack : un livrable incomplet le
// dit, il ne se contente pas d'être incomplet.
//
// L'EMPREINTE EST LA PREUVE, PAS LE NOM DU FICHIER. `storage_hash` (SHA-256 du contenu) est ce qui
// atteste qu'on parle bien du même justificatif que le jour de la saisie : un nom de fichier se
// change, une empreinte non. Elle est nulle sur les pièces déposées avant l'introduction du champ,
// et la colonne le montre alors vide plutôt que de laisser croire à une preuve qui n'existe pas.

export interface LignePisteAudit {
  // L'écriture. Nuls/vides sur une ligne qui part d'un justificatif non comptabilisé.
  ecritureId: string | null
  date: string
  compte: string
  libelle: string
  debit: number
  credit: number
  // Le justificatif.
  pieceId: string | null
  pieceTiers: string | null
  pieceDate: string | null
  pieceMontantTtc: number | null
  pieceFichier: string | null
  pieceEmpreinte: string | null
  // L'opération réelle.
  mouvementDate: string | null
  mouvementLibelle: string | null
  mouvementMontant: number | null
  // Ce qui manque sur CETTE ligne, en clair. Vide quand la chaîne est complète.
  manque: string[]
}

// `pieces` doit contenir les pièces VALIDÉES du dossier : ce sont les seules dont l'absence
// d'écriture est une information (une pièce « à valider » est la corbeille d'arrivée, la signaler
// noierait le signal — même raison que `piecesValideesSansCategorie` dans controles.ts).
export function pisteAudit(
  ecritures: EcritureBrouillon[],
  pieces: Piece[],
  lignesBancaires: LigneBancaire[],
): LignePisteAudit[] {
  const pieceParId = new Map(pieces.map((p) => [p.id, p]))
  const ligneParId = new Map(lignesBancaires.map((l) => [l.id, l]))
  const piecesCitees = new Set(ecritures.map((e) => e.piece_id).filter((id): id is string => !!id))

  const depuisEcritures = ecritures.map((e): LignePisteAudit => {
    const piece = e.piece_id ? pieceParId.get(e.piece_id) ?? null : null
    const mouvement = e.ligne_bancaire_id ? ligneParId.get(e.ligne_bancaire_id) ?? null : null
    const manque: string[] = []
    if (!e.piece_id) manque.push('justificatif')
    // Distinguer « le lien est nul » de « le lien pointe une ligne absente du jeu fourni » : la
    // seconde n'est pas une rupture, c'est un filtre de l'appelant. Le dire autrement ferait passer
    // un artefact de chargement pour un défaut comptable.
    else if (!piece) manque.push('justificatif hors du jeu chargé')
    if (e.compte === COMPTE_BANQUE && !e.ligne_bancaire_id) manque.push('mouvement bancaire')
    // Même distinction côté banque. Avec `ON DELETE SET NULL` sur les deux clés, un mouvement
    // supprimé met le lien à NULL et tombe dans la branche précédente : ce cas-ci ne peut donc venir
    // que d'un jeu de lignes restreint par l'appelant. Le dire plutôt que de laisser trois colonnes
    // vides s'expliquer toutes seules — une colonne vide non commentée se lit comme une absence de
    // preuve, ce qui est exactement ce qu'un export de piste d'audit ne doit pas laisser croire.
    else if (e.ligne_bancaire_id && !mouvement) manque.push('mouvement hors du jeu chargé')

    return {
      ecritureId: e.id,
      date: e.date,
      compte: e.compte,
      libelle: e.libelle,
      debit: e.sens === 'debit' ? e.montant : 0,
      credit: e.sens === 'credit' ? e.montant : 0,
      pieceId: piece?.id ?? null,
      pieceTiers: piece?.tiers ?? null,
      pieceDate: piece?.date_piece ?? null,
      pieceMontantTtc: piece?.montant_ttc ?? null,
      pieceFichier: piece?.nom_fichier ?? null,
      pieceEmpreinte: piece?.storage_hash ?? null,
      mouvementDate: mouvement?.date ?? null,
      mouvementLibelle: mouvement?.libelle ?? null,
      mouvementMontant: mouvement?.montant ?? null,
      manque,
    }
  })

  // L'autre sens : un justificatif validé que rien ne comptabilise. Sa ligne porte la pièce et rien
  // de l'écriture — c'est justement ce qui manque.
  const depuisPieces = pieces
    .filter((p) => !piecesCitees.has(p.id))
    .map((p): LignePisteAudit => ({
      ecritureId: null,
      date: p.date_piece ?? '',
      compte: '',
      libelle: p.tiers ?? p.nom_fichier,
      debit: 0,
      credit: 0,
      pieceId: p.id,
      pieceTiers: p.tiers,
      pieceDate: p.date_piece,
      pieceMontantTtc: p.montant_ttc,
      pieceFichier: p.nom_fichier,
      pieceEmpreinte: p.storage_hash,
      mouvementDate: null,
      mouvementLibelle: null,
      mouvementMontant: null,
      // Une pièce sans date n'appartient à aucun exercice : elle apparaîtra donc dans l'export de
      // CHACUN d'eux (l'appelant ne peut pas la rattacher à l'un sans la retirer des autres, et la
      // taire serait pire — c'est la règle de la feuille « Pièces sans date » d'un pack). Le manque
      // est nommé pour que sa présence ne se lise jamais comme « elle est de cet exercice-là ».
      manque: p.date_piece ? ['écriture'] : ['écriture', 'date'],
    }))

  // Chronologique, comme l'exige une piste d'audit. Les lignes sans date (justificatif dont la date
  // n'a pas été lue) remontent en tête plutôt que de se perdre au milieu : une date absente est
  // précisément ce qu'il faut voir. `compte` puis `ecritureId` départagent à date égale, pour que
  // deux exports du même brouillon soient identiques — l'ordre de retour d'une requête ne l'est pas.
  return [...depuisEcritures, ...depuisPieces].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.compte.localeCompare(b.compte) ||
      (a.ecritureId ?? a.pieceId ?? '').localeCompare(b.ecritureId ?? b.pieceId ?? ''),
  )
}

const COLONNES_PISTE = [
  'Date', 'Compte', 'Libellé écriture', 'Débit', 'Crédit',
  'Tiers', 'Date pièce', 'Montant pièce', 'Fichier justificatif', 'Empreinte SHA-256',
  'Date mouvement', 'Libellé bancaire', 'Montant mouvement', 'Ce qui manque',
]

// Le séparateur point-virgule et la virgule décimale sont la convention française d'Excel — un
// tableur qui ouvre ce fichier doit montrer des colonnes, pas une seule colonne de texte.
function champCsv(valeur: string): string {
  // Un libellé venu de l'OCR contient des sauts de ligne et des guillemets ; sans neutralisation ils
  // coupent la ligne en deux et le fichier devient structurellement faux (même piège que le FEC).
  const propre = valeur.replace(/[\r\n]+/g, ' ').trim()
  return propre.includes(';') || propre.includes('"') ? `"${propre.replace(/"/g, '""')}"` : propre
}

const montantCsv = (v: number | null): string => (v === null ? '' : v.toFixed(2).replace('.', ','))

export function genererPisteAuditCsv(lignes: LignePisteAudit[]): string {
  const corps = lignes.map((l) =>
    [
      l.date, l.compte, champCsv(l.libelle), montantCsv(l.debit), montantCsv(l.credit),
      champCsv(l.pieceTiers ?? ''), l.pieceDate ?? '', montantCsv(l.pieceMontantTtc),
      champCsv(l.pieceFichier ?? ''), l.pieceEmpreinte ?? '',
      l.mouvementDate ?? '', champCsv(l.mouvementLibelle ?? ''), montantCsv(l.mouvementMontant),
      champCsv(l.manque.join(' + ')),
    ].join(';'),
  )
  // BOM UTF-8. Sans lui, Excel en français ouvre le fichier en CP1252 et « Libellé » devient
  // « LibellÃ© » — sur un export destiné à être relu par un vérificateur, un accent cassé sur chaque
  // ligne jette le doute sur le reste. C'est le premier export CSV de l'application ; la règle est
  // donc posée ici.
  return '\uFEFF' + [COLONNES_PISTE.join(';'), ...corps].join('\r\n')
}

export function nomFichierPisteAudit(nomDossier: string, annee: number): string {
  return `piste-audit-${nomDossier.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-${annee}.csv`
}
