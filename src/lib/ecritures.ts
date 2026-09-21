import { COMPTE_BANQUE, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE } from './comptes'
import { dateLocaleDe } from './format'
import type { Categorie, EcritureBrouillon, Piece } from './types'

// Suggestions de compte PCG / poste 2035 par catégorie de dépense — un point de départ à
// valider ou ajuster par le cabinet (voir "Comptes manquants" dans Écritures, "Postes manquants"
// dans Clôture), jamais enregistré tout seul : ça ne fait que pré-remplir le champ avant le clic
// explicite sur "Enregistrer". Indexé sur le "code" stable de la catégorie (pas le libellé,
// modifiable) — ne joue donc que pour les catégories globales par défaut (dossier_id null) ; une
// catégorie propre à un dossier reste à renseigner à la main, faute de correspondance connue.
export const SUGGESTIONS_COMPTE_PAR_CODE: Record<string, { compte: string; poste2035: string }> = {
  achats_fournisseurs: { compte: '606100', poste2035: 'Achats' },
  loyer: { compte: '613200', poste2035: 'Loyers et charges locatives' },
  assurance: { compte: '616100', poste2035: "Primes d'assurance" },
  carburant_deplacements: { compte: '625100', poste2035: 'Frais de déplacement' },
  notes_frais: { compte: '625700', poste2035: 'Frais de réception, de représentation' },
  honoraires: { compte: '622600', poste2035: 'Honoraires ne constituant pas des rétrocessions' },
  frais_bancaires: { compte: '627000', poste2035: 'Frais financiers' },
  ventes_prestations: { compte: '706000', poste2035: 'Recettes' },
}

// Une ligne d'écriture brouillon avant insertion (pas encore d'id) — le shape exact attendu par
// `ecritures_brouillon`, hors ligne_bancaire_id (uniquement pertinent pour la contrepartie banque).
export interface LigneAGenerer {
  dossier_id: string
  piece_id: string
  date: string
  libelle: string
  sens: 'debit' | 'credit'
  statut: 'proposee'
  compte: string
  montant: number
}

// Ligne(s) charge/produit (+ TVA séparée le cas échéant) pour une pièce donnée — extrait de
// EcrituresTab pour être appelé aussi bien en génération initiale (une pièce sans encore d'écriture)
// qu'en régénération (une pièce déjà passée en écritures, mais modifiée depuis — voir
// piecesDesynchronisees dans EcrituresTab). Ne couvre jamais la contrepartie banque, gérée séparément
// par synchroniserContrepartieBanque (voir lib/contrepartieBanque.ts).
export function lignesChargeProduitPourPiece(dossierId: string, piece: Piece, compteComptable: string): LigneAGenerer[] {
  const sensPiece: 'debit' | 'credit' = piece.type_piece === 'vente' ? 'credit' : 'debit'
  const libelle = piece.tiers ?? piece.nom_fichier
  const date = piece.date_piece ?? dateLocaleDe(piece.created_at)
  const base = { dossier_id: dossierId, piece_id: piece.id, date, libelle, statut: 'proposee' as const }

  // Un montant de pièce négatif (avoir, remboursement — ça arrive, une pièce validée existante en a
  // un) inverse le sens réel de l'écriture : une "charge" négative est en réalité un crédit, jamais un
  // débit avec un montant négatif. `montant` reste toujours une grandeur positive, sinon le contrôle
  // débit = crédit (voir analyserEcritures) se fausse silencieusement — un solde qui semble équilibré
  // à zéro montant près pourrait en réalité être doublé dans le mauvais sens.
  function ligne(compte: string, montant: number): LigneAGenerer {
    const sens = montant >= 0 ? sensPiece : (sensPiece === 'debit' ? 'credit' : 'debit')
    return { ...base, compte, sens, montant: Math.abs(montant) }
  }

  if (piece.montant_tva) {
    const montantHt = piece.montant_ht ?? piece.montant_ttc! - piece.montant_tva
    return [
      ligne(compteComptable, montantHt),
      ligne(piece.type_piece === 'vente' ? COMPTE_TVA_COLLECTEE : COMPTE_TVA_DEDUCTIBLE, piece.montant_tva),
    ]
  }
  return [ligne(compteComptable, piece.montant_ttc!)]
}

// Solde d'un compte sur un ensemble d'écritures, dans le sens comptable normal de ce compte (débiteur
// pour une charge ou la TVA déductible, créditeur pour un produit ou la TVA collectée). Jamais une
// simple somme des montants (qui ignorerait le sens) : dès qu'une ligne au sens inverse apparaît — un
// avoir, un remboursement, voir lignesChargeProduitPourPiece — une somme aveugle additionnerait cette
// ligne au lieu de la soustraire, faussant silencieusement le total.
export function soldeCompte(ecritures: EcritureBrouillon[], compte: string, sensNormal: 'debit' | 'credit'): number {
  const lignes = ecritures.filter((e) => e.compte === compte)
  const debit = lignes.filter((e) => e.sens === 'debit').reduce((sum, e) => sum + e.montant, 0)
  const credit = lignes.filter((e) => e.sens === 'credit').reduce((sum, e) => sum + e.montant, 0)
  return sensNormal === 'debit' ? debit - credit : credit - debit
}

// Tolérance de 2 centimes pour l'arrondi flottant — un écart réel (frais bancaires, paiement
// partiel, pièce modifiée après génération...) est en général bien plus grand, donc quasiment jamais
// absorbé par cette marge.
const EPSILON_EQUILIBRE = 0.02

export interface GroupeDesequilibre {
  pieceId: string
  solde: number
}

export interface AnalyseEcritures {
  // Écriture encore à moitié générée (charge/produit sans sa contrepartie banque) — pas forcément un
  // défaut, la pièce n'est peut-être pas encore rapprochée dans Banque.
  nbSansContrepartie: number
  // Écriture complète (contrepartie présente) dont le total débit ne correspond pas au total crédit.
  groupesDesequilibres: GroupeDesequilibre[]
  // Pièce modifiée depuis que son écriture a été générée — montant TTC, VENTILATION DE LA TVA,
  // CATÉGORIE ou DATE. Les trois derniers ne déplacent AUCUN total, donc rien d'autre ne peut les
  // voir : la catégorie change le compte qui part en FEC, la date change l'EXERCICE, et la TVA
  // change la répartition entre charge et TVA déductible à somme constante.
  piecesDesynchronisees: Piece[]
}

// TVA nette (collectée - déductible) du brouillon sur une période donnée — comparée à la TVA
// réellement déclarée (voir DeclarationTva, EcrituresTab) pour un cross-check comptable vs déclaré.
// Bornes incluses ; comparaison de chaînes ISO (YYYY-MM-DD), valide tant que les dates le sont.
export function tvaNettePourPeriode(ecritures: EcritureBrouillon[], periodeDebut: string, periodeFin: string): number {
  const dansPeriode = ecritures.filter((e) => e.date >= periodeDebut && e.date <= periodeFin)
  return soldeCompte(dansPeriode, COMPTE_TVA_COLLECTEE, 'credit') - soldeCompte(dansPeriode, COMPTE_TVA_DEDUCTIBLE, 'debit')
}

// Ce qu'une pièce validée DOIT produire au brouillon, et sur quel compte. La règle vivait en
// DOUBLE, écrite à l'identique dans EcrituresTab et ChecklistTab — une règle recopiée deux fois
// n'attend pas de diverger, elle attend un troisième appelant. Elle porte les trois portes de la
// chaîne comptable (catégorie, compte de la catégorie, montant) plus une quatrième que rien ne
// nommait : une pièce enregistrée en immobilisation est un ACTIF, pas une charge courante — elle
// s'amortit, elle ne se déduit pas d'un coup.
export interface PieceAComptabiliser {
  piece: Piece
  compte: string
}

export function piecesAComptabiliser(
  piecesValidees: Piece[],
  categories: Categorie[],
  pieceIdsImmobilisees: ReadonlySet<string>,
): PieceAComptabiliser[] {
  return piecesValidees.flatMap((piece) => {
    if (piece.montant_ttc == null || pieceIdsImmobilisees.has(piece.id)) return []
    const compte = categories.find((c) => c.id === piece.categorie_id)?.compte_comptable
    return compte ? [{ piece, compte }] : []
  })
}

// Pourquoi une pièce validée ne doit plus rien produire au brouillon. L'ordre compte : une pièce
// immobilisée est le cas le plus coûteux ET celui où « Régénérer » est activement faux (il
// réécrirait la charge), donc il se lit en premier.
export type MotifSansObjet = 'immobilisee' | 'sans_categorie' | 'categorie_sans_compte' | 'sans_montant'

export interface EcritureSansObjet {
  piece: Piece
  motif: MotifSansObjet
  nbLignes: number
  // Débit − crédit des lignes hors banque : positif pour une charge, négatif pour un produit.
  // C'est exactement ce que le FEC, la balance et la 2035 comptent en trop.
  montant: number
}

function motifSansObjet(
  piece: Piece,
  categories: Categorie[],
  pieceIdsImmobilisees: ReadonlySet<string>,
): MotifSansObjet | null {
  if (pieceIdsImmobilisees.has(piece.id)) return 'immobilisee'
  if (!piece.categorie_id) return 'sans_categorie'
  if (!categories.find((c) => c.id === piece.categorie_id)?.compte_comptable) return 'categorie_sans_compte'
  if (piece.montant_ttc == null) return 'sans_montant'
  return null
}

// QUATRIÈME CONTRÔLE, ET IL REGARDE LA PIÈCE DEPUIS L'ÉCRITURE. Les trois autres sont aveugles au
// même objet, en même temps, mais pas pour la même raison : les deux premiers ne jugent que la
// FORME du groupe (contrepartie présente, solde nul), or le groupe en question est parfaitement
// formé ; et le troisième juge bien la pièce, mais en partant de la liste éligible — dont celle-ci
// vient précisément de sortir. Rien ne supprime une écriture quand sa pièce est enregistrée en
// immobilisation — et c'est l'ordre naturel des gestes, puisqu'on découvre qu'un achat est un actif
// en ouvrant l'onglet Immobilisations, donc après avoir généré.
// CE QUE ÇA COÛTE EXACTEMENT, et la nuance vaut d'être écrite : la 2035 se calcule sur les PIÈCES et
// exclut déjà les immobilisées (voir declaration2035.ts) — elle est donc juste. Le FEC et la balance
// se calculent sur le BROUILLON et portent la charge entière. Les deux livrables décrivent alors
// deux résultats différents pour le même euro, et rien ne le dit : exactement l'incohérence que le
// cas `piece_id` nul a déjà coûtée une fois.
// C'est la même famille que `rupturesPisteAudit` (voir lib/pisteAudit.ts), appliquée à l'autre bout
// de la même relation.
export function ecrituresSansObjet(
  ecritures: EcritureBrouillon[],
  piecesValidees: Piece[],
  categories: Categorie[],
  pieceIdsImmobilisees: ReadonlySet<string>,
): EcritureSansObjet[] {
  const parPiece = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    // `piece_id` nul est le domaine de rupturesPisteAudit, pas d'ici. Et la contrepartie banque
    // reflète un mouvement RÉEL : elle ne disparaît pas parce que la pièce a changé de nature.
    if (!e.piece_id || e.compte === COMPTE_BANQUE) continue
    parPiece.set(e.piece_id, [...(parPiece.get(e.piece_id) ?? []), e])
  }
  const sansObjet: EcritureSansObjet[] = []
  for (const [pieceId, lignes] of parPiece) {
    const piece = piecesValidees.find((p) => p.id === pieceId)
    // Absente du jeu fourni : artefact de FILTRAGE, pas rupture — l'appelant ne charge que les
    // pièces validées, donc une pièce repassée « à valider » tomberait ici. La signaler ferait
    // crier au loup sur un choix de chargement, et un avertissement qui se trompe emporte dans son
    // discrédit les avertissements voisins qui, eux, disent vrai.
    if (!piece) continue
    const motif = motifSansObjet(piece, categories, pieceIdsImmobilisees)
    if (!motif) continue
    sansObjet.push({
      piece,
      motif,
      nbLignes: lignes.length,
      montant: lignes.reduce((somme, e) => somme + (e.sens === 'debit' ? e.montant : -e.montant), 0),
    })
  }
  return sansObjet
}

// Trois contrôles d'intégrité sur le brouillon d'écritures, partagés entre EcrituresTab (où ils
// bloquent/alertent dans le détail) et ChecklistTab (vue d'ensemble du dossier) — un seul endroit où
// ces règles vivent. `aComptabiliser` : ce que chaque pièce validée doit produire, et sur quel
// compte (voir piecesAComptabiliser). Le quatrième, `ecrituresSansObjet`, est à part parce qu'il
// part de l'écriture et non de la pièce.
export function analyserEcritures(ecritures: EcritureBrouillon[], aComptabiliser: PieceAComptabiliser[]): AnalyseEcritures {
  const piecesParGroupe = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    if (!e.piece_id) continue
    piecesParGroupe.set(e.piece_id, [...(piecesParGroupe.get(e.piece_id) ?? []), e])
  }
  const nbSansContrepartie = [...piecesParGroupe.values()].filter((rows) => !rows.some((r) => r.compte === COMPTE_BANQUE)).length

  const groupesDesequilibres = [...piecesParGroupe.entries()]
    .filter(([, rows]) => rows.some((r) => r.compte === COMPTE_BANQUE))
    .map(([pieceId, rows]) => ({
      pieceId,
      solde: rows.reduce((sum, r) => sum + (r.sens === 'debit' ? r.montant : -r.montant), 0),
    }))
    .filter((g) => Math.abs(g.solde) > EPSILON_EQUILIBRE)

  const piecesDesynchronisees = aComptabiliser.filter(({ piece: p, compte }) => {
    const lignes = ecritures.filter((e) => e.piece_id === p.id && e.compte !== COMPTE_BANQUE)
    if (lignes.length === 0) return false // pas encore générée — pas une désynchronisation
    // Signé par rapport au sens naturel de la pièce (achat = débit, vente = crédit) : une simple somme
    // des montants (toujours positifs) donnerait un faux "désynchronisée" sur une pièce à montant
    // négatif (avoir, remboursement), dont les lignes sont correctement enregistrées au sens inverse
    // par lignesChargeProduitPourPiece — pas en écart, juste du signe attendu pour ce cas-là.
    const sensPiece: 'debit' | 'credit' = p.type_piece === 'vente' ? 'credit' : 'debit'
    // LE COMPTE AUTANT QUE LE MONTANT. Recatégoriser une pièce déjà validée est un geste courant,
    // et rien ne réécrit l'écriture : elle reste sur l'ANCIEN compte. Or le total, lui, ne bouge pas
    // d'un centime — un contrôle qui ne regarde que le montant déclare donc « synchronisée » une
    // écriture qui partira en FEC sur un compte que la pièce ne désigne plus, pendant que Clôture et
    // la 2035 lisent le poste 2035 de la catégorie ACTUELLE. Deux livrables, deux réponses, aucun
    // signal — c'est mot pour mot l'incohérence que rupturesPisteAudit a déjà coûté une fois.
    const surUnAutreCompte = lignes.some(
      (e) => e.compte !== compte && e.compte !== COMPTE_TVA_DEDUCTIBLE && e.compte !== COMPTE_TVA_COLLECTEE,
    )
    if (surUnAutreCompte) return true
    // ET LA VENTILATION DE LA TVA, QUE LE TOTAL NE PEUT PAS VOIR — le panneau annonçait pourtant
    // « montant, TVA » depuis toujours. Corriger `montant_tva` en gardant le TTC laisse le total du
    // groupe RIGOUREUSEMENT INCHANGÉ (les deux lignes se compensent) et les comptes identiques : ni
    // la comparaison de montant ni celle de compte ne peut en dire un mot. Même silence quand la TVA
    // est ajoutée ou effacée après coup, le nombre de lignes changeant sans que leur somme bouge.
    // Ce que ça coûte : la charge et la TVA déductible partent FAUSSES en FEC et en balance, à somme
    // juste — pendant que la 2035, calculée sur les pièces, dit autre chose. Encore deux livrables
    // pour un seul euro.
    // On compare la TVA ENREGISTRÉE à celle que la pièce annonce (0 quand elle n'en porte pas, ce
    // qui couvre d'un coup l'ajout et l'effacement) ; signée comme le total, sinon un avoir passerait
    // pour un écart. Démontré sur une pièce réelle du schéma : 57,00 € portés en charge entière alors
    // que la pièce annonce 50,91 + 6,09 de TVA, total juste, compte juste, contrôle muet.
    const tvaEnregistree = lignes
      .filter((e) => e.compte === COMPTE_TVA_DEDUCTIBLE || e.compte === COMPTE_TVA_COLLECTEE)
      .reduce((sum, e) => sum + (e.sens === sensPiece ? e.montant : -e.montant), 0)
    if (Math.abs(tvaEnregistree - (p.montant_tva ?? 0)) > EPSILON_EQUILIBRE) return true
    // LA DATE AUTANT QUE LE COMPTE, ET ELLE COÛTE PLUS CHER QUE LUI. Une pièce validée sans date
    // reçoit une écriture datée de son DÉPÔT (le repli de lignesChargeProduitPourPiece) ; « Retrouver
    // les dates manquantes » écrit ensuite `date_piece` sans toucher à l'écriture — par conception,
    // c'est ce qui la rend sûre à lancer sur un dossier déjà relu à la main. Rien ne réconcilie les
    // deux, et corriger à la main la date d'une pièce déjà générée fait exactement pareil.
    // Le compte, lui, gardait au moins la bonne année. Ici non : sur les pièces réelles du projet, le
    // dépôt suit la date de la pièce de 549 jours en MÉDIANE (1 336 au maximum) et 68 pièces tombent
    // dans une autre année civile. L'écriture part donc dans le mauvais EXERCICE — le filtre
    // d'exercice et le FEC lisent `e.date`, pendant que Clôture et la 2035 lisent `date_piece`. Le
    // FEC embarque même la contradiction sur UNE SEULE LIGNE, sa colonne PieceDate venant de la
    // pièce et EcritureDate de l'écriture.
    // On ne compare QUE si la pièce porte une date : sans date elle ne prétend à aucun exercice, donc
    // il n'y a rien à contredire — et comparer au repli ferait crier au loup dès qu'une écriture a
    // été générée dans un autre fuseau que celui qui la relit, `dateLocaleDe` lisant un INSTANT.
    if (p.date_piece && lignes.some((e) => e.date !== p.date_piece)) return true
    const total = lignes.reduce((sum, e) => sum + (e.sens === sensPiece ? e.montant : -e.montant), 0)
    return Math.abs(total - p.montant_ttc!) > EPSILON_EQUILIBRE
  }).map(({ piece }) => piece)

  return { nbSansContrepartie, groupesDesequilibres, piecesDesynchronisees }
}

// Libellé des trois comptes PCG fixes (voir constantes ci-dessus) — jamais rattachés à une catégorie
// (contrairement à un compte de charge/produit), donc absents de `categories` : sans ce repère, la
// balance (voir calculerBalance) les afficherait avec un libellé vide.
const LIBELLES_COMPTES_FIXES: Record<string, string> = {
  [COMPTE_BANQUE]: 'Banque',
  [COMPTE_TVA_DEDUCTIBLE]: 'TVA déductible',
  [COMPTE_TVA_COLLECTEE]: 'TVA collectée',
}

export interface LigneBalance {
  compte: string
  libelle: string
  nbEcritures: number
  totalDebit: number
  totalCredit: number
  // Positif = solde débiteur, négatif = solde créditeur — jamais réparti sur deux colonnes ici
  // (contrairement à soldeCompte, qui a besoin de connaître le sens normal du compte pour ça) : une
  // balance générale regroupe tous les comptes, charges et produits confondus, sans a priori sur leur
  // sens habituel.
  solde: number
}

// Balance des comptes (onglet Statistiques) — un compte par ligne, tous confondus (charge, produit,
// TVA, banque), avec son nombre d'écritures et ses totaux débit/crédit. Sert à repérer d'un coup d'œil
// un compte au solde anormal (une charge créditrice, par exemple) sans avoir à parcourir le journal
// ligne à ligne comme dans EcrituresTab. Le libellé vient de la catégorie associée à ce compte
// (compte_comptable) quand elle existe, sinon des trois comptes fixes ci-dessus, sinon "—" (compte
// entré à la main sur une catégorie propre à un dossier, jamais recroisé ici avec son libellé).
export function calculerBalance(ecritures: EcritureBrouillon[], categories: Categorie[]): LigneBalance[] {
  const libelleParCompte = new Map<string, string>()
  for (const c of categories) {
    if (c.compte_comptable) libelleParCompte.set(c.compte_comptable, c.libelle)
  }

  const lignesParCompte = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    lignesParCompte.set(e.compte, [...(lignesParCompte.get(e.compte) ?? []), e])
  }

  return [...lignesParCompte.entries()]
    .map(([compte, lignes]) => {
      const totalDebit = lignes.filter((l) => l.sens === 'debit').reduce((sum, l) => sum + l.montant, 0)
      const totalCredit = lignes.filter((l) => l.sens === 'credit').reduce((sum, l) => sum + l.montant, 0)
      return {
        compte,
        libelle: LIBELLES_COMPTES_FIXES[compte] ?? libelleParCompte.get(compte) ?? '—',
        nbEcritures: lignes.length,
        totalDebit,
        totalCredit,
        solde: totalDebit - totalCredit,
      }
    })
    .sort((a, b) => a.compte.localeCompare(b.compte))
}
