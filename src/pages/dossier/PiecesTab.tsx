import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, formatDate, formatMoney } from '../../lib/format'
import { suggererCategorie } from '../../lib/tiersCategories'
import { AVERTISSEMENT_RAPPROCHEMENT_DEFAIT, LIBELLE_MOTIF_TVA, moisEnDoubleSurAbonnement, piecesADateImpossible, piecesDeviseNonConvertie, piecesTvaImpossible } from '../../lib/controles'
import { messageErreur } from '../../lib/messageErreur'
import { DEVISE_PIVOT } from '../../lib/devises'
import { piecesARelire, relireDocuments } from '../../lib/relectureDocuments'
import { piecesAvecTexteOcr, texteOcrDeLaPiece } from '../../lib/texteOcr'
import { chargerDoublonsDeTexte, type DoublonDeTexte } from '../../lib/doublonsTexte'
import { grouperParTiers } from '../../lib/suggestionTiers'
import { lireTout } from '../../lib/lectureComplete'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import type { Categorie, Piece, PieceCommentaire, SousDossier, TiersCategorie, TiersCategorieCabinet } from '../../lib/types'
import { chargerCommentaires, commentairesParCible, dernierCommentaire } from '../../lib/commentaires'
import PieceFormModal from './PieceFormModal'
import AjouterDocumentsModal from './AjouterDocumentsModal'
import ImportDossierModal from './ImportDossierModal'
import SuperPdpModal from './SuperPdpModal'
import CategoriserTiersModal from './CategoriserTiersModal'
import { useAnnee } from '../../context/AnneeContext'
import { useAuth } from '../../context/AuthContext'
import { retirerFichiers } from '../../lib/stockage'

export default function PiecesTab({ dossierId }: { dossierId: string }) {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [sousDossiers, setSousDossiers] = useState<SousDossier[]>([])
  const [tiersCategories, setTiersCategories] = useState<TiersCategorie[]>([])
  const [tiersCategoriesCabinet, setTiersCategoriesCabinet] = useState<TiersCategorieCabinet[]>([])
  const [applyingSuggestions, setApplyingSuggestions] = useState(false)
  const [categoriserTiers, setCategoriserTiers] = useState(false)
  const [loading, setLoading] = useState(true)
  const [statutFilter, setStatutFilter] = useState<'toutes' | 'a_valider' | 'validee'>('toutes')
  const [sousDossierFilter, setSousDossierFilter] = useState<'tous' | 'sans' | string>('tous')
  // L'exercice lui-même vient de l'en-tête du dossier (voir AnneeContext, partagé avec Banque,
  // Écritures, Statistiques et Clôture) — "sans date" reste un filtre local, propre aux pièces : les
  // autres onglets partagés n'ont pas cette notion (un mouvement bancaire ou une écriture a toujours
  // une date), donc rien à unifier avec l'en-tête pour ce cas précis. Mutuellement exclusif avec
  // l'exercice sélectionné : cocher "Sans date" met de côté le filtre d'exercice, comme avant.
  const { annee: anneeFilter } = useAnnee()
  // Sert à mémoriser aussi la règle au niveau cabinet quand la catégorie est globale — une mutuelle
  // ou une banque reviennent d'un dossier à l'autre (voir CategoriserTiersModal).
  const { monCabinetId } = useAuth()
  const [sansDateOnly, setSansDateOnly] = useState(false)
  const [editing, setEditing] = useState<Piece | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [ajoutOuvert, setAjoutOuvert] = useState(false)
  const [importDossierOuvert, setImportDossierOuvert] = useState(false)
  const [superPdpOpen, setSuperPdpOpen] = useState(false)
  // Pièces déjà rapprochées d'un mouvement bancaire (voir BanqueTab) — pour ne plus laisser
  // "Validée" seule donner l'impression que le traitement d'une pièce est terminé (voir audit
  // ergonomie comparatif) : validation, paiement/rapprochement et écriture générée sont trois états
  // distincts, une pièce validée n'a pas forcément encore été rapprochée d'un mouvement réel.
  const [piecesRapprochees, setPiecesRapprochees] = useState<Set<string>>(new Set())
  // Reprise groupée des pièces incomplètes (voir lib/relectureDocuments.ts). L'avancement est affiché
  // pièce par pièce : chaque PDF repasse par Textract, donc l'opération dure des dizaines de secondes
  // sur un lot, et un bouton qui semble figé pousserait à recharger la page en plein traitement.
  const [reextraction, setReextraction] = useState<{ fait: number; total: number; nomFichier: string } | null>(null)
  // Verrou en ref et non dans l'état ci-dessus : `disabled={reextraction !== null}` ne prend effet
  // qu'au rendu suivant et laisse donc passer deux clics rapprochés — chacun repartant avec son
  // propre jeu de pièces à relire, donc payant deux fois les mêmes appels Textract. Même famille que
  // le double import en masse (141 lignes pour 78 fichiers).
  const relectureEnCours = useRef(false)
  const [recherche, setRecherche] = useState('')
  // Précisions déposées par le client (et notes du cabinet) sur les pièces — voir lib/commentaires.ts.
  const [commentaires, setCommentaires] = useState<PieceCommentaire[]>([])
  // Identifiants SEULS des pièces dont on a le texte lu : de quoi savoir où proposer « texte lu »
  // sans rapatrier les textes, qui pèsent des kilo-octets chacun (voir lib/texteOcr.ts).
  const [avecTexteOcr, setAvecTexteOcr] = useState<Set<string>>(new Set())
  // Même garde que dans DocumentsTab : une liste qu'on n'a pas pu lire ne vaut pas « aucun texte ».
  // Relancer la lecture sur cette base paierait Textract sur des pièces déjà lues.
  const [presenceTexteIncertaine, setPresenceTexteIncertaine] = useState<string | null>(null)
  // Non nul quand la liste des pièces n'a pas pu être lue en entier (voir lib/lectureComplete.ts).
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  // Séparé de `lectureIncomplete` : le bandeau dit ce qui est devenu FAUX, et ce n'est pas la même
  // chose pour une liste de pièces tronquée que pour un fil de précisions tronqué. Les fondre en un
  // seul afficherait, sur l'un des deux cas, une conséquence qui n'est pas la sienne.
  const [commentairesIncomplets, setCommentairesIncomplets] = useState<string | null>(null)
  // Troisième drapeau : les listes de référence (rapprochements, catégories, sous-dossiers, règles
  // apprises). Les fondre avec `lectureIncomplete` ferait porter aux pièces une conséquence qui
  // n'est pas la leur.
  const [referencesIncompletes, setReferencesIncompletes] = useState<string | null>(null)
  const [doublonsTexte, setDoublonsTexte] = useState<DoublonDeTexte[]>([])
  // Le texte de la pièce dépliée, chargé à la demande. Une seule à la fois : c'est une consultation
  // ponctuelle pour lever un doute, pas une colonne du tableau.
  const [ocrOuvert, setOcrOuvert] = useState<{ pieceId: string; texte: string | null } | null>(null)

  async function load() {
    setLoading(true)
    // Lues par tranches, triées sur un ordre TOTAL : le plafond de PostgREST ne se signale pas
    // (voir lib/lectureComplete.ts). Tronquée, la liste ne paraît pas vide — elle paraît complète,
    // et les contrôles posés dessus (doublon de contenu, mois en double) se taisent sur le reste.
    const lecturePieces = await lireTout<Piece>((debut, fin) =>
      supabase.from('pieces').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId)
        .order('date_piece', { ascending: false, nullsFirst: false }).order('id').range(debut, fin),
    )
    const piecesData = lecturePieces.lignes
    setLectureIncomplete(lecturePieces.complete ? null : lecturePieces.motif)

    const lectureRapprochees = await lireTout<{ piece_id: string | null }>((debut, fin) =>
      supabase.from('lignes_bancaires').select('piece_id', { count: 'exact' })
        .eq('dossier_id', dossierId)
        .eq('statut', 'rapprochee')
        .not('piece_id', 'is', null)
        .order('id').range(debut, fin),
    )
    const lignesBancairesData = lectureRapprochees.lignes

    const lectureCategories = await lireTout<Categorie>((debut, fin) =>
      supabase.from('categories').select('*', { count: 'exact' })
        .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre').order('id').range(debut, fin),
    )

    const lectureSousDossiers = await lireTout<SousDossier>((debut, fin) =>
      supabase.from('sous_dossiers').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('ordre').order('nom').order('id').range(debut, fin),
    )

    // LES RÈGLES APPRISES. Une ligne par arbitrage posé, donc une liste qui ne fait que grandir —
    // et tronquée, elle ne se signale pas : les règles absentes cessent simplement de s'appliquer,
    // et l'opérateur recatégorise à la main un fournisseur qu'il a déjà arbitré dix fois.
    const lectureTiersCategories = await lireTout<TiersCategorie>((debut, fin) =>
      supabase.from('tiers_categories').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    )

    // Même raisonnement, à l'échelle du cabinet : c'est la table qui porte le travail partagé
    // entre dossiers, donc la première des deux à grandir.
    const lectureTiersCabinet = await lireTout<TiersCategorieCabinet>((debut, fin) =>
      supabase.from('tiers_categories_cabinet').select('*', { count: 'exact' })
        .order('id').range(debut, fin),
    )
    // Le commentaire ci-dessus NOMMAIT le dégât — « les règles absentes cessent simplement de
    // s'appliquer » — au-dessus d'un code qui jetait le drapeau permettant de le voir. Les cinq
    // listes de référence partagent une même conséquence, distincte de celle des pièces : elles ne
    // raccourcissent pas la liste, elles font paraître une pièce MOINS TRAITÉE qu'elle ne l'est
    // (`sousDossierLabel` rend « — » pour un sous-dossier absent, le badge de rapprochement retombe
    // sur « non rapprochée »), ou taisent une catégorie déjà arbitrée.
    setReferencesIncompletes(
      [lectureRapprochees, lectureCategories, lectureSousDossiers, lectureTiersCategories, lectureTiersCabinet]
        .find((l) => !l.complete)?.motif ?? null,
    )

    // Les précisions portées par le client sur ses dépôts. Chargées ici, en une requête pour tout le
    // dossier, et passées à la ligne : c'est le seul endroit où elles servent vraiment, au moment où
    // l'opérateur choisit une catégorie sans savoir ce qu'est « BOULANGER MARSEILLE ».
    const lectureCommentaires = await chargerCommentaires(dossierId)
    setCommentaires(lectureCommentaires.commentaires)
    setCommentairesIncomplets(lectureCommentaires.motif)
    const presence = await piecesAvecTexteOcr(dossierId)
    setAvecTexteOcr(presence.avecTexte)
    setPresenceTexteIncertaine(presence.erreur)
    // Best-effort, comme les relevés incohérents de la Checklist : l'échec est journalisé, jamais lu
    // comme « aucun doublon » — un écran qui affiche « rien à signaler » sur une lecture refusée dit
    // le contraire de ce qu'il sait.
    setDoublonsTexte(await chargerDoublonsDeTexte(dossierId).catch((err) => {
      console.error(err)
      return [] as DoublonDeTexte[]
    }))

    setPieces(piecesData ?? [])
    setCategories(lectureCategories.lignes)
    setSousDossiers(lectureSousDossiers.lignes)
    setTiersCategories(lectureTiersCategories.lignes)
    setTiersCategoriesCabinet(lectureTiersCabinet.lignes)
    setPiecesRapprochees(new Set((lignesBancairesData ?? []).map((l) => l.piece_id as string)))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [dossierId])

  // Un dossier est par client, pas par année (voir Estimation) — les pièces s'accumulent sur plusieurs
  // exercices sans jamais être archivées ailleurs. Le filtre d'exercice ne déplace rien, il joue sur
  // la vraie date du document (date_piece) plutôt que sa date d'ajout dans l'appli.
  const aPiecesSansDate = pieces.some((p) => !p.date_piece)

  const filteredBase = pieces.filter((p) => {
    if (statutFilter !== 'toutes' && p.statut !== statutFilter) return false
    if (sousDossierFilter === 'sans' && p.sous_dossier_id) return false
    if (sousDossierFilter !== 'tous' && sousDossierFilter !== 'sans' && p.sous_dossier_id !== sousDossierFilter) return false
    if (sansDateOnly) return !p.date_piece
    if (anneeFilter !== 'toutes' && (!p.date_piece || anneeDe(p.date_piece) !== anneeFilter)) return false
    return true
  })
  // Sur le dossier entier, pas sur le filtre affiché : c'est l'écran où la pièce se corrige encore,
  // et le montant reste faux quel que soit l'exercice qu'on regarde (voir lib/controles.ts).
  const motifTvaParPiece = new Map(piecesTvaImpossible(pieces).map(({ piece, motif }) => [piece.id, motif]))

  // Deux échéances d'un même abonnement dans le même mois, avec un mois voisin vide : l'une des deux
  // porte une date mal lue (voir lib/controles.ts). Sur la LIGNE, comme la TVA impossible, parce que
  // c'est ici que la pièce se corrige — et parce que l'autre écran qui en souffre, le rapprochement
  // bancaire, ne sait dire que « plusieurs pièces possibles », c'est-à-dire le symptôme.
  // Le même document déposé deux fois sous deux fichiers différents — ce que l'empreinte du FICHIER
  // ne peut pas voir (voir lib/doublonsTexte.ts). Sur la ligne, comme les deux autres badges : c'est
  // ici qu'on ouvre les deux pièces pour décider laquelle supprimer.
  const doublonParPiece = new Map<string, number>()
  for (const doublon of doublonsTexte) {
    for (const id of doublon.pieceIds) doublonParPiece.set(id, doublon.pieceIds.length + doublon.documentIds.length)
  }

  // LES DEUX BADGES QUI MANQUAIENT. Cinq contrôles de la famille « donnée démontrée fausse »
  // envoient l'opérateur ici depuis la Checklist (`cible: 'pieces'`), et trois seulement marquaient
  // la ligne. Les deux autres — date postérieure au dépôt, devise non convertie — annonçaient donc
  // « 1 pièce, corrigez-la » puis renvoyaient vers une liste où RIEN ne la désigne. C'est le défaut
  // déjà nommé pour `doublon-texte` : un point qui compte et ne montre pas se paie en crédit, et
  // l'opérateur cesse de croire le suivant.
  // Sur le dossier entier comme ses voisins, jamais sur le filtre affiché : une date fausse range
  // justement la pièce dans un exercice où on ne la cherche pas.
  const dateImpossibleParPiece = new Map(
    piecesADateImpossible(pieces).map(({ piece, date, borne }) => [piece.id, { date, borne }]),
  )
  const deviseNonConvertieIds = new Set(piecesDeviseNonConvertie(pieces).map((piece) => piece.id))

  const moisSuspectParPiece = new Map<string, string>()
  for (const trouve of moisEnDoubleSurAbonnement(pieces)) {
    for (const piece of trouve.pieces) {
      moisSuspectParPiece.set(piece.id, `Deux échéances « ${trouve.tiers.replace(/\n/g, ' ')} » de ${formatMoney(trouve.montant)} en ${trouve.mois}, aucune en ${trouve.moisProbable} — l'une des deux est probablement de ${trouve.moisProbable}.`)
    }
  }

  // "À valider" seulement : les pièces à faible confiance d'extraction remontent en premier — ce sont
  // celles qui ont le plus de chances d'avoir un champ faux, donc celles qui méritent d'être regardées
  // avant les autres plutôt que de tout revérifier au même niveau d'attention (voir Piece.confiance).
  // Tri stable (Array.sort) : à confiance égale, l'ordre par date d'origine est conservé.
  //
  // Une TVA impossible passe AVANT la confiance basse, et pas au même rang : la confiance est un
  // pronostic de l'extraction sur elle-même — souvent « haute » sur les pièces fausses, c'est tout le
  // problème — là où l'impossibilité est démontrée. Un doute ne prime pas sur une certitude.
  const PRIORITE_CONFIANCE: Record<string, number> = { basse: 0, moyenne: 1, haute: 2 }
  const prioriteDe = (p: Piece) =>
    // Même rang que la TVA impossible, et pour la même raison : ce n'est pas un pronostic mais une
    // impossibilité démontrée — un abonnement mensuel ne facture pas deux fois le même mois en
    // laissant le mois d'à côté vide.
    motifTvaParPiece.has(p.id) || moisSuspectParPiece.has(p.id) || doublonParPiece.has(p.id) ? -1 : (PRIORITE_CONFIANCE[p.confiance ?? ''] ?? 3)
  const trie = statutFilter === 'a_valider'
    ? [...filteredBase].sort((a, b) => prioriteDe(a) - prioriteDe(b))
    : filteredBase
  // Pièces du dossier entier, pas seulement du filtre affiché : ce sont elles qui n'entrent dans
  // aucun pack, et l'oubli ne dépend pas de l'exercice qu'on regarde au moment du clic. Le bouton
  // annonce le nombre, donc ce qu'il va traiter reste explicite.
  const piecesIncompletes = piecesARelire(pieces, avecTexteOcr)
  const tiersConnus = [...new Set(pieces.map((p) => p.tiers).filter((t): t is string => !!t))]
  const categorieLabel = (id: string | null) => categories.find((c) => c.id === id)?.libelle ?? '—'
  // Cherchable = ce qui est lisible sur la ligne. Le montant TTC en fait partie : retrouver « 192 »
  // parmi des dizaines de factures d'un même fournisseur est un usage courant.
  const commentairesParPiece = commentairesParCible(commentaires)
  const filDeLaPiece = (id: string) => commentairesParPiece.get(`piece:${id}`) ?? []

  // Le texte des précisions entre dans la recherche : c'est souvent le seul endroit où figure ce
  // qu'était vraiment l'achat, quand ni le nom du fichier ni le tiers lu par l'OCR ne le disent.
  const filtered = trie.filter((p) =>
    correspondALaRecherche(
      [p.nom_fichier, p.tiers, categorieLabel(p.categorie_id), p.type_piece, p.date_piece,
       p.date_piece ? formatDate(p.date_piece) : null, p.montant_ttc,
       ...filDeLaPiece(p.id).map((c) => c.texte)],
      recherche,
    ),
  )

  const sousDossierLabel = (id: string | null) => sousDossiers.find((s) => s.id === id)?.nom ?? '—'

  // Le texte lu ne se charge qu'au clic : garder les quatre-vingts textes d'un dossier en mémoire
  // pour qu'un seul soit lu coûterait à chaque ouverture d'onglet ce qu'on ne consulte qu'une fois.
  async function basculerTexteOcr(pieceId: string) {
    if (ocrOuvert?.pieceId === pieceId) { setOcrOuvert(null); return }
    // Affiché tout de suite en « chargement », sinon un document de plusieurs pages laisse la ligne
    // muette assez longtemps pour qu'on reclique.
    setOcrOuvert({ pieceId, texte: null })
    const texte = await texteOcrDeLaPiece(pieceId)
    setOcrOuvert((actuel) => (actuel?.pieceId === pieceId ? { pieceId, texte } : actuel))
  }

  // Catégorie suggérée pour une pièce pas encore catégorisée, d'après son tiers — règle du dossier ou
  // du cabinet déjà apprise (voir lib/tiersCategories.ts). Juste un aperçu tant que rien n'est
  // appliqué : la pièce garde categorie_id à null jusqu'au clic explicite ci-dessous ou dans la fiche.
  const suggestionPour = (p: Piece): string | null => {
    if (p.categorie_id || !p.tiers) return null
    return suggererCategorie(p.tiers, tiersCategories, tiersCategoriesCabinet)
  }
  const piecesAvecSuggestion = pieces.filter((p) => suggestionPour(p) !== null)

  // Fournisseurs distincts encore à arbitrer — c'est le vrai volume de travail restant, bien plus
  // parlant que le nombre de pièces : sur un import réel, 58 pièces ne portaient que 28 tiers.
  const groupesACategoriser = grouperParTiers(pieces, categories, tiersCategories, tiersCategoriesCabinet)

  // Un seul clic pour reprendre, sur toutes les pièces sans catégorie, la correspondance déjà connue
  // pour leur tiers — sans passer par chaque fiche une par une. Ne fait rien sur les pièces sans
  // correspondance connue : elles restent à catégoriser à la main comme avant.
  async function appliquerSuggestions() {
    if (piecesAvecSuggestion.length === 0) return
    setApplyingSuggestions(true)
    await Promise.all(
      piecesAvecSuggestion.map((p) => supabase.from('pieces').update({ categorie_id: suggestionPour(p) }).eq('id', p.id)),
    )
    setApplyingSuggestions(false)
    load()
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function validateSelection() {
    const ids = [...selected].filter((id) => pieces.find((p) => p.id === id)?.montant_ttc != null)
    if (ids.length === 0) return
    await supabase.from('pieces').update({ statut: 'validee' }).in('id', ids)
    setSelected(new Set())
    load()
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((p) => p.id)))
    }
  }

  // Suppression ligne par ligne (pas un `.in()` groupé) : l'échec sur une pièce ne doit pas empêcher
  // de supprimer le reste de la sélection, juste être compté à part.
  //
  // LE MOTIF D'ORIGINE ÉTAIT FAUX, ET SON MESSAGE ENVOYAIT CHERCHER UN LIEN QUI NE BLOQUE RIEN. Il
  // annonçait une contrainte de clé étrangère (23503) « rapprochement bancaire ou pack déjà généré ».
  // Mesuré le 23/09/2026 : les CINQ clés étrangères entrantes de `pieces` sont en SET NULL ou
  // CASCADE, aucune en NO ACTION — une suppression de pièce ne peut donc JAMAIS lever 23503 ; et
  // `packs` n'a aucune clé entrante du tout, `pack_pieces` ayant été supprimée. « Retire d'abord ce
  // lien » ne désignait donc rien à retirer, pendant que la vraie conséquence — le rapprochement
  // bancaire défait en silence — n'était nommée nulle part.
  //
  // Le compte reste (un refus RLS, une coupure), mais il RAPPORTE sa raison au lieu de l'inventer.
  async function deleteSelection() {
    if (selected.size === 0) return
    if (!window.confirm(
      `Supprimer définitivement ${selected.size} pièce(s) ? Cette action est irréversible.\n\n${AVERTISSEMENT_RAPPROCHEMENT_DEFAIT}`,
    )) return
    let supprimees = 0
    const echecs: string[] = []
    for (const id of selected) {
      const piece = pieces.find((p) => p.id === id)
      const { error } = await supabase.from('pieces').delete().eq('id', id)
      if (error) {
        echecs.push(messageErreur(error))
        continue
      }
      if (piece?.storage_path) {
        await retirerFichiers('pieces', [piece.storage_path], 'PiecesTab')
      }
      supprimees++
    }
    setSelected(new Set())
    load()
    if (echecs.length > 0) {
      // La RAISON plutôt qu'une cause devinée : les motifs distincts, sans les répéter autant de
      // fois qu'il y a de pièces (un refus RLS les frappe toutes de la même façon).
      window.alert(
        `${supprimees} pièce(s) supprimée(s). ${echecs.length} n'ont pas pu l'être :\n${[...new Set(echecs)].join('\n')}`,
      )
    }
  }

  // Rejoue l'extraction sur les pièces du dossier auxquelles il manque une date OU le texte lu
  // (voir lib/relectureDocuments.ts pour la garantie : rien d'autre n'est jamais écrit). Les deux en
  // une seule passe — chaque relecture est un appel Textract facturé, les séparer paierait deux fois
  // la même lecture.
  async function relirePiecesIncompletes() {
    if (piecesIncompletes.length === 0 || relectureEnCours.current || presenceTexteIncertaine) return
    if (!window.confirm(
      `Relancer la lecture automatique sur ${piecesIncompletes.length} pièce(s) ?\n\n` +
      `Cela renseigne la date quand elle manque, et archive le texte lu sur le document pour l'afficher ici.\n` +
      `Le tiers, les montants et le statut ne sont jamais modifiés, et une date déjà saisie n'est jamais remplacée.\n` +
      `Chaque pièce repasse par l'analyse, compte quelques secondes par document.`,
    )) return

    // Posé AVANT le premier `await` — un verrou posé après ne verrouille rien.
    relectureEnCours.current = true
    setReextraction({ fait: 0, total: piecesIncompletes.length, nomFichier: '' })
    let resultat
    try {
      resultat = await relireDocuments(pieces, avecTexteOcr, (fait, total, nomFichier) =>
        setReextraction({ fait, total, nomFichier }),
      )
    } finally {
      relectureEnCours.current = false
      setReextraction(null)
    }
    load()

    const deduites = resultat.datees.filter((d) => d.deduite)
    const lignes = [
      `${resultat.datees.length} pièce(s) datée(s).`,
      `${resultat.textesArchives.length} texte(s) lu(s) archivé(s) — visibles sous « texte lu » sur chaque ligne.`,
    ]
    if (deduites.length > 0) {
      // Dites à part, avec leur date : elles viennent de la règle de dernier recours (première date
      // en ordre de lecture) et non d'un libellé reconnu. Juste dans la très grande majorité des
      // mises en page, mais c'est une déduction — elle se vérifie d'un coup d'œil sur la liste.
      lignes.push(
        `\nDont ${deduites.length} déduite(s) de la mise en page, à vérifier :\n` +
        deduites.slice(0, 10).map((d) => `• ${d.nomFichier} → ${d.date}`).join('\n') +
        (deduites.length > 10 ? `\n… et ${deduites.length - 10} autre(s)` : ''),
      )
    }
    if (resultat.sansDate.length > 0) {
      // Les dates vues sont affichées telles quelles : c'est ce qui permet de comprendre pourquoi la
      // lecture n'a pas tranché, plutôt que de rester sur un « ça n'a pas marché ».
      const detail = resultat.sansDate
        .slice(0, 5)
        .map((s) => `• ${s.nomFichier}${s.datesVues.length > 0 ? ` — dates vues : ${s.datesVues.join(', ')}` : ' — aucune date lisible'}`)
        .join('\n')
      lignes.push(
        `\n${resultat.sansDate.length} pièce(s) restent sans date :\n${detail}` +
        (resultat.sansDate.length > 5 ? `\n… et ${resultat.sansDate.length - 5} autre(s)` : ''),
      )
    }
    if (resultat.echecs.length > 0) {
      lignes.push(`\n${resultat.echecs.length} en échec :\n` + resultat.echecs.slice(0, 5).map((e) => `• ${e.nomFichier} : ${e.message}`).join('\n'))
    }
    window.alert(lignes.join('\n'))
  }

  async function createSousDossier() {
    const nom = window.prompt('Nom du sous-dossier (ex : 2024, Chantier A, Notes de frais Jean)')
    if (!nom || !nom.trim()) return
    const { error } = await supabase.from('sous_dossiers').insert({ dossier_id: dossierId, nom: nom.trim() })
    if (error) {
      window.alert(error.message)
      return
    }
    load()
  }

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les pièces du dossier"
        motif={lectureIncomplete}
        consequence={
          'La liste ci-dessous n’est donc pas complète, et les contrôles posés dessus (doublon de ' +
          'contenu, mois en double) se taisent sur ce qu’ils n’ont pas vu.'
        }
      />
      <BandeauLecturePartielle
        quoi="Les précisions déposées par le client"
        motif={commentairesIncomplets}
        consequence={
          'Une pièce peut donc porter une précision sans qu’elle apparaisse sur sa ligne — et c’est ' +
          'l’appel au client que ces précisions existent pour éviter. Vérifie dans la fiche avant ' +
          'de catégoriser.'
        }
      />

      <BandeauLecturePartielle
        quoi="Les listes de référence du dossier"
        motif={referencesIncompletes}
        consequence={
          'Une pièce peut donc paraître sans catégorie, sans sous-dossier ou non rapprochée alors ' +
          'qu’elle l’est, et une règle déjà arbitrée cesse de proposer sa catégorie. Recharge la ' +
          'page avant d’arbitrer.'
        }
      />

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un fichier, un tiers, une catégorie, un montant…"
          affiches={filtered.length}
          total={trie.length}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['toutes', 'a_valider', 'validee'] as const).map((s) => (
            <button
              key={s}
              className={`btn btn-sm ${statutFilter === s ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setStatutFilter(s)}
            >
              {s === 'toutes' ? 'Toutes' : s === 'a_valider' ? 'À valider' : 'Validées'}
            </button>
          ))}
          {/* Filtre local, indépendant de l'exercice de l'en-tête (voir déclaration de sansDateOnly
              ci-dessus) — une pièce sans date n'appartient à aucun exercice, ça ne fait pas sens de
              l'unifier avec le sélecteur partagé. */}
          {aPiecesSansDate && (
            <button
              className={`btn btn-sm ${sansDateOnly ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setSansDateOnly((v) => !v)}
              title="Pièces sans date renseignée, en dehors de tout exercice"
            >
              Sans date
            </button>
          )}
          <select value={sousDossierFilter} onChange={(e) => setSousDossierFilter(e.target.value)} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', fontSize: '0.8rem' }}>
            <option value="tous">Tous les sous-dossiers</option>
            <option value="sans">Sans sous-dossier</option>
            {sousDossiers.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
          </select>
          <button className="btn btn-outline btn-sm" onClick={createSousDossier}>+ Sous-dossier</button>
          {filtered.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={toggleSelectAll}>
              {selected.size === filtered.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {piecesAvecSuggestion.length > 0 && (
            <button className="btn btn-outline btn-sm" disabled={applyingSuggestions} onClick={appliquerSuggestions}>
              {applyingSuggestions ? 'Application…' : `Appliquer les suggestions (${piecesAvecSuggestion.length})`}
            </button>
          )}
          {groupesACategoriser.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={() => setCategoriserTiers(true)}>
              Catégoriser par fournisseur ({groupesACategoriser.length})
            </button>
          )}
          {piecesIncompletes.length > 0 && !presenceTexteIncertaine && (
            <button
              className="btn btn-outline btn-sm"
              disabled={reextraction !== null}
              onClick={relirePiecesIncompletes}
              title="Relance la lecture automatique : retrouve la date quand elle manque, et archive le texte lu sur le document pour l'afficher ici. Montants, tiers et statut ne sont jamais modifiés, et une date déjà saisie n'est jamais remplacée."
            >
              {reextraction
                ? `Lecture… ${reextraction.fait}/${reextraction.total}${reextraction.nomFichier ? ` — ${reextraction.nomFichier}` : ''}`
                : `Relire les documents (${piecesIncompletes.length})`}
            </button>
          )}
          {selected.size > 0 && (
            <>
              <button className="btn btn-outline btn-sm" onClick={validateSelection}>
                Valider la sélection ({selected.size})
              </button>
              <button className="btn btn-danger btn-sm" onClick={deleteSelection}>
                Supprimer la sélection ({selected.size})
              </button>
            </>
          )}
          <button className="btn btn-outline btn-sm" onClick={() => setSuperPdpOpen(true)}>🔌 Facture électronique</button>
          <button className="btn btn-outline btn-sm" onClick={() => setImportDossierOuvert(true)} title="Pour importer une arborescence de dossiers depuis ton ordinateur, avec sous-dossiers automatiques">
            📁 Importer un dossier complet
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setAjoutOuvert(true)}>+ Ajouter des documents</button>
        </div>
      </div>

      {presenceTexteIncertaine && (
        // Dit pourquoi le bouton a disparu, plutôt que de le laisser manquer sans raison visible.
        <p className="error-text">
          La liste des textes déjà lus n'a pas pu être chargée ({presenceTexteIncertaine}) —
          « Relire les documents » est masqué : relancer la lecture repaierait Textract sur des
          pièces dont le texte est peut-être déjà archivé.
        </p>
      )}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            {recherche.trim() ? `Aucune pièce ne correspond à « ${recherche.trim()} ».` : 'Aucune pièce.'}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="col-checkbox"></th>
                <th>Date</th>
                <th>Tiers</th>
                <th className="hide-mobile">Catégorie</th>
                <th className="hide-mobile">Sous-dossier</th>
                <th>Montant TTC</th>
                <th className="hide-mobile">Confiance</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <Fragment key={p.id}>
                <tr className="clickable">
                  <td className="col-checkbox" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                  </td>
                  <td onClick={() => setEditing(p)}>{formatDate(p.date_piece)}</td>
                  <td onClick={() => setEditing(p)}>
                    {p.tiers ?? '—'}
                    {/* La dernière précision est lue ICI, sur la ligne, pas dans la fiche : si
                        l'opérateur doit ouvrir une modale pour savoir ce qu'est « BOULANGER
                        MARSEILLE », il choisira la catégorie sans l'avoir lue. Le plus récent des
                        commentaires prime — quand le cabinet a rappelé le client, sa note vaut mieux
                        que la précision initiale. */}
                    {(() => {
                      const fil = filDeLaPiece(p.id)
                      const dernier = dernierCommentaire(fil)
                      if (!dernier) return null
                      return (
                        <div className="piece-precision" title={fil.map((c) => `${c.origine === 'cabinet' ? 'Cabinet' : 'Client'} : ${c.texte}`).join('\n')}>
                          <span className={`badge ${dernier.origine === 'cabinet' ? 'badge-neutral' : 'badge-ok'}`}>
                            {dernier.origine === 'cabinet' ? 'Cabinet' : 'Client'}
                          </span>
                          <span>{dernier.texte}</span>
                          {fil.length > 1 && <span className="muted"> +{fil.length - 1}</span>}
                        </div>
                      )
                    })()}
                    {/* « BOULANGER MARSEILLE » ne dit pas ce qui a été acheté — le texte du document,
                        lui, le dit. Il était lu à l'extraction puis jeté ; il se consulte maintenant
                        ici, sans quitter la ligne ni ouvrir la fiche. */}
                    {avecTexteOcr.has(p.id) && (
                      <button
                        type="button"
                        className="lien-texte-lu"
                        onClick={(e) => { e.stopPropagation(); basculerTexteOcr(p.id) }}
                        title="Afficher le texte lu par la reconnaissance automatique sur ce document"
                      >
                        {ocrOuvert?.pieceId === p.id ? '▾ texte lu' : '▸ texte lu'}
                      </button>
                    )}
                  </td>
                  <td className="hide-mobile" onClick={() => setEditing(p)}>
                    {p.categorie_id ? (
                      categorieLabel(p.categorie_id)
                    ) : suggestionPour(p) ? (
                      <>— <span className="muted" style={{ fontSize: '0.8rem' }}>(suggéré : {categorieLabel(suggestionPour(p))})</span></>
                    ) : '—'}
                  </td>
                  <td className="hide-mobile" onClick={() => setEditing(p)}>{sousDossierLabel(p.sous_dossier_id)}</td>
                  <td onClick={() => setEditing(p)}>
                    {formatMoney(p.montant_ttc)}
                    {/* Le montant affiché est en euros ; le document, lui, dit autre chose. Sans ce
                        rappel, chercher « 24 » sur une facture OpenAI ne donne rien — la ligne
                        porte 20,52. */}
                    {p.devise !== DEVISE_PIVOT && (
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        {p.montant_devise != null ? `${p.montant_devise.toFixed(2)} ${p.devise}` : p.devise}
                        {/* Provisoire tant que la banque n'a pas tranché : le taux BCE ignore le
                            spread et les frais réellement appliqués. Le dire évite qu'un montant à
                            quelques centimes près passe pour définitif. */}
                        {p.taux_change == null
                          ? ' — à convertir'
                          : p.conversion_source === 'bce' && ' — provisoire'}
                      </div>
                    )}
                    {/* Sur la ligne, pas seulement dans un onglet de contrôle : c'est ici que la
                        pièce se valide, et une fois validée le chiffre part tel quel en TVA
                        déductible. Le badge dit ce qui est démontré faux, pas « à vérifier ». */}
                    {motifTvaParPiece.has(p.id) && (
                      <div style={{ marginTop: 4 }}>
                        <span className="badge badge-danger" style={{ fontSize: '0.7rem' }} title={`TVA lue : ${formatMoney(p.montant_tva)} — ${LIBELLE_MOTIF_TVA[motifTvaParPiece.get(p.id)!]}`}>
                          TVA impossible
                        </span>
                      </div>
                    )}
                    {moisSuspectParPiece.has(p.id) && (
                      <div style={{ marginTop: 4 }}>
                        <span className="badge badge-danger" style={{ fontSize: '0.7rem' }} title={moisSuspectParPiece.get(p.id)}>
                          Mois à vérifier
                        </span>
                      </div>
                    )}
                    {dateImpossibleParPiece.has(p.id) && (
                      <div style={{ marginTop: 4 }}>
                        <span
                          className="badge badge-danger"
                          style={{ fontSize: '0.7rem' }}
                          title={`Datée du ${formatDate(dateImpossibleParPiece.get(p.id)!.date)}, déposée le ${formatDate(dateImpossibleParPiece.get(p.id)!.borne)} : on ne photographie pas une facture qui n'existe pas encore. Ce qui a été lu est autre chose — une validité, une échéance, ou un chiffre mal reconnu. Telle quelle, la pièce part dans un exercice où personne ne la compte comme manquante.`}
                        >
                          Date impossible
                        </span>
                      </div>
                    )}
                    {deviseNonConvertieIds.has(p.id) && (
                      <div style={{ marginTop: 4 }}>
                        <span
                          className="badge badge-danger"
                          style={{ fontSize: '0.7rem' }}
                          title={`Montant en ${p.devise} sans taux de change : ce qui entre en comptabilité est la valeur en devise prise pour des euros. Le montant définitif se lit sur le relevé bancaire, pas sur un cours de référence.`}
                        >
                          Devise non convertie
                        </span>
                      </div>
                    )}
                    {doublonParPiece.has(p.id) && (
                      <div style={{ marginTop: 4 }}>
                        <span
                          className="badge badge-danger"
                          style={{ fontSize: '0.7rem' }}
                          title={`${doublonParPiece.get(p.id)} pièces/documents de ce dossier ont exactement le même texte lu — c'est le même document déposé plusieurs fois, sous des fichiers différents. L'empreinte du fichier ne peut pas le voir.`}
                        >
                          Doublon de contenu
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="hide-mobile" onClick={() => setEditing(p)}>
                    {p.confiance === 'basse' && <span className="badge badge-danger">Basse — à vérifier</span>}
                    {p.confiance === 'moyenne' && <span className="badge badge-warning">Moyenne</span>}
                    {p.confiance === 'haute' && <span className="badge badge-ok">Haute</span>}
                    {!p.confiance && <span className="muted">—</span>}
                  </td>
                  <td onClick={() => setEditing(p)}>
                    {p.statut === 'validee'
                      ? <span className="badge badge-ok">Validée</span>
                      : <span className="badge badge-warning">À valider</span>}
                    {/* Distinct de la validation (voir audit ergonomie comparatif) : une pièce validée
                        n'est pas forcément encore rapprochée d'un mouvement bancaire réel — l'un ne
                        dit rien de l'autre, jamais fusionnés dans un seul badge "tout est fait". */}
                    {p.statut === 'validee' && (
                      <div style={{ marginTop: 4 }}>
                        {piecesRapprochees.has(p.id)
                          ? <span className="badge badge-ok" style={{ fontSize: '0.7rem' }}>Rapprochée</span>
                          : <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>Non rapprochée</span>}
                      </div>
                    )}
                  </td>
                </tr>
                {ocrOuvert?.pieceId === p.id && (
                  <tr>
                    <td colSpan={8} style={{ background: 'var(--color-surface-2)' }}>
                      <div className="texte-lu">
                        <div className="texte-lu-entete">
                          <strong>Texte lu sur le document</strong>
                          <span className="muted">
                            Tel que la reconnaissance automatique l'a lu, sans correction — c'est ce
                            qui a servi à remplir les champs ci-dessus.
                          </span>
                        </div>
                        {ocrOuvert.texte === null
                          ? <p className="muted" style={{ margin: 0 }}>Chargement…</p>
                          : <pre className="texte-lu-corps">{ocrOuvert.texte}</pre>}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <PieceFormModal
          dossierId={dossierId}
          categories={categories}
          sousDossiers={sousDossiers}
          tiersCategories={tiersCategories}
          tiersCategoriesCabinet={tiersCategoriesCabinet}
          tiersConnus={tiersConnus}
          piece={editing}
          commentaires={filDeLaPiece(editing.id)}
          onClose={() => setEditing(null)}
          onSaved={load}
          onCommentaireAjoute={(c) => setCommentaires((prev) => [...prev, c])}
          onCommentaireSupprime={(id) => setCommentaires((prev) => prev.filter((c) => c.id !== id))}
        />
      )}

      {ajoutOuvert && (
        <AjouterDocumentsModal
          dossierId={dossierId}
          sousDossiers={sousDossiers}
          onClose={() => setAjoutOuvert(false)}
          onImported={load}
        />
      )}

      {importDossierOuvert && (
        <ImportDossierModal
          dossierId={dossierId}
          sousDossiers={sousDossiers}
          onClose={() => setImportDossierOuvert(false)}
          onImported={load}
        />
      )}

      {superPdpOpen && (
        <SuperPdpModal dossierId={dossierId} onClose={() => setSuperPdpOpen(false)} onImported={load} />
      )}

      {categoriserTiers && (
        <CategoriserTiersModal
          dossierId={dossierId}
          cabinetId={monCabinetId}
          pieces={pieces}
          categories={categories}
          reglesDossier={tiersCategories}
          reglesCabinet={tiersCategoriesCabinet}
          onClose={() => setCategoriserTiers(false)}
          onApplied={load}
        />
      )}
    </>
  )
}
