import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { cleFournisseur, normalizeTiers, slugify } from '../../lib/format'
import { extractPiece, fichierDejaPresent, hashFichier } from '../../lib/extraction'
import { suggererCategorie } from '../../lib/tiersCategories'
import { AVERTISSEMENT_RAPPROCHEMENT_DEFAIT, LIBELLE_MOTIF_TVA, piecesTvaImpossible } from '../../lib/controles'
import { convertirMontants, deviseDuTexte, DEVISE_PIVOT, libelleConversion } from '../../lib/devises'
import { tauxBce } from '../../lib/tauxChange'
import { useAuth } from '../../context/AuthContext'
import type { Categorie, Piece, PieceCommentaire, SousDossier, TiersCategorie, TiersCategorieCabinet, TypePiece } from '../../lib/types'
import FilCommentaires from '../../components/FilCommentaires'
import { EntetePanneau } from '../../components/PanneauDroit'
import { IconChevron, IconPrecedent } from '../../components/icons'
import { messageErreur } from '../../lib/messageErreur'
import { retirerFichiers } from '../../lib/stockage'
import { libelleIssue, type PropositionCategorie } from '../../lib/categorisationIa'
import { proposerCategorie } from '../../lib/propositionCategorie'

// L'apprentissage tiers → catégorie ne doit jamais faire échouer l'enregistrement d'une pièce : il
// reste best-effort. Mais l'avaler en silence n'est pas la même chose, et c'est ce qui a permis à la
// règle cabinet d'échouer à chaque fois sans que rien ne le signale — la table est restée vide alors
// que les quatre règles de dossier, elles, se sont bien écrites. Un échec est désormais journalisé.
async function memoriser(quoi: string, requete: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await requete
  if (error) console.warn(`Mémorisation de ${quoi} impossible (sans conséquence sur la pièce) :`, error.message)
}

function typeApercu(nom: string): 'image' | 'pdf' | 'autre' {
  const ext = nom.toLowerCase().split('.').pop() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return 'autre'
}

// La fiche d'une pièce, dans le panneau de droite (voir lib/panneauDroit.ts) — elle était une fenêtre
// modale qui assombrissait tout l'écran, et elle reste un simple contenu : c'est l'écran appelant qui
// la pose dans le volet, lui donne sa place dans la liste et décide de ce qui suit un enregistrement.
// Ce qu'elle y gagne est le geste que la maquette validée mettait en avant : parcourir et valider les
// pièces à la chaîne, la liste toujours visible à côté, sans rouvrir de fenêtre.
interface Props {
  dossierId: string
  categories: Categorie[]
  sousDossiers: SousDossier[]
  tiersCategories: TiersCategorie[]
  tiersCategoriesCabinet: TiersCategorieCabinet[]
  tiersConnus: string[]
  piece: Piece | null // null = création
  // Le fil des précisions de cette pièce, déjà chargé par l'écran appelant — voir lib/commentaires.ts.
  commentaires: PieceCommentaire[]
  onClose: () => void
  onSaved: () => void
  // Remonté à l'écran appelant : une précision ajoutée ici doit apparaître sur la ligne d'arbitrage
  // même si la fiche est fermée sans être enregistrée. Commenter n'est pas modifier la pièce.
  onCommentaireAjoute: (commentaire: PieceCommentaire) => void
  onCommentaireSupprime: (id: string) => void
  // Sa place dans la liste d'où elle est ouverte (« Justificatif 3 sur 12 ») et de quoi passer à la
  // voisine sans y revenir — null aux deux bouts.
  navigation?: { position: string; precedente: (() => void) | null; suivante: (() => void) | null }
  // Rapprochée d'un mouvement bancaire : dit dans la fiche comme sur la ligne de la liste.
  rapprochee?: boolean
  // Après une VALIDATION, l'écran appelant enchaîne sur la prochaine pièce à valider. Sans lui, la
  // fiche se ferme, comme la fenêtre d'avant.
  onValidee?: (pieceId: string) => void
  // Rapporte si la fiche porte une saisie non enregistrée : c'est l'écran appelant qui garde le volet
  // (la garde de sortie de lib/panneauDroit.ts). Doit être une fonction STABLE.
  onModifiee?: (modifiee: boolean) => void
  // L'écran appelant SAIT que cette pièce n'a pas de texte lu : « Proposer une catégorie » n'aurait
  // rien à citer, donc ne s'affiche pas. Dans le doute (liste des textes illisible), il reste : la
  // fonction refuse alors sans appeler le modèle, donc sans rien facturer.
  sansTexteLu?: boolean
}

export default function FichePiece({ dossierId, categories, sousDossiers, tiersCategories, tiersCategoriesCabinet, tiersConnus, piece, commentaires: commentairesInitiaux, onClose, onSaved, onCommentaireAjoute, onCommentaireSupprime, navigation, rapprochee = false, onValidee, onModifiee, sansTexteLu = false }: Props) {
  // Cabinet de l'utilisateur connecté : la règle tiers → catégorie partagée entre dossiers lui
  // appartient (contrainte unique (cabinet_id, tiers_normalise), RLS admin_du_cabinet). L'omettre
  // était l'une des deux raisons pour lesquelles elle ne s'écrivait jamais.
  const { monCabinetId } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [datePiece, setDatePiece] = useState(piece?.date_piece ?? '')
  const [tiers, setTiers] = useState(piece?.tiers ?? '')
  const [typePiece, setTypePiece] = useState<TypePiece>(piece?.type_piece ?? 'achat')
  const [categorieId, setCategorieId] = useState(piece?.categorie_id ?? '')
  const [sousDossierId, setSousDossierId] = useState(piece?.sous_dossier_id ?? '')
  const [montantHt, setMontantHt] = useState(piece?.montant_ht?.toString() ?? '')
  const [montantTva, setMontantTva] = useState(piece?.montant_tva?.toString() ?? '')
  const [montantTtc, setMontantTtc] = useState(piece?.montant_ttc?.toString() ?? '')
  // La devise et sa conversion suivent la pièce sans être modifiables champ par champ : un taux saisi
  // à la main ne serait plus justifiable devant un contrôle. Ce qui est offert, c'est de REFAIRE la
  // conversion au taux BCE de la date courante — le cas qui arrive vraiment, quand la date lue était
  // fausse et qu'on vient de la corriger.
  const [devise, setDevise] = useState(piece?.devise ?? DEVISE_PIVOT)
  const [montantDevise, setMontantDevise] = useState<number | null>(piece?.montant_devise ?? null)
  const [tauxChange, setTauxChange] = useState<number | null>(piece?.taux_change ?? null)
  const [conversionSource, setConversionSource] = useState<'bce' | 'banque' | null>(piece?.conversion_source ?? null)
  const [dateTaux, setDateTaux] = useState<string | null>(null)
  const [conversionEnCours, setConversionEnCours] = useState(false)
  const [conversionErreur, setConversionErreur] = useState<string | null>(null)
  const [notes, setNotes] = useState(piece?.notes ?? '')
  const [commentaires, setCommentaires] = useState(commentairesInitiaux)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)
  // Initialisé depuis la pièce (pas null) : sans ça, rouvrir une pièce déjà extraite sans relancer
  // l'extraction écraserait sa confiance enregistrée à la sauvegarde suivante.
  const [confiance, setConfiance] = useState<'haute' | 'moyenne' | 'basse' | null>(piece?.confiance ?? null)
  const [suggestionAutre, setSuggestionAutre] = useState<string | null>(null)
  const [lignesBrutes, setLignesBrutes] = useState<string[] | undefined>(undefined)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  // La catégorie proposée par le modèle, avec le TYPE pour lequel elle a été demandée : le sens de la
  // pièce décide des catégories proposables, donc une proposition faite pour un achat ne vaut plus
  // rien quand l'opérateur repasse la pièce en vente.
  const [proposition, setProposition] = useState<{ pourType: TypePiece; resultat: PropositionCategorie } | null>(null)
  const [proposant, setProposant] = useState(false)
  const [erreurProposition, setErreurProposition] = useState<string | null>(null)

  // Une saisie NON ENREGISTRÉE : tout champ qui s'écarte de la pièce telle qu'ouverte, un fichier
  // choisi, une extraction qui a rempli le formulaire. Dans une fenêtre modale la question ne se
  // posait pas — rien d'autre n'était cliquable. Dans le volet, une autre ligne, « suivante »,
  // « Assistant » ou la croix peuvent chasser la fiche : l'écran appelant s'en sert pour demander
  // avant de laisser partir ce qui a été tapé.
  const modifiee = file !== null
    || datePiece !== (piece?.date_piece ?? '')
    || tiers !== (piece?.tiers ?? '')
    || typePiece !== (piece?.type_piece ?? 'achat')
    || categorieId !== (piece?.categorie_id ?? '')
    || sousDossierId !== (piece?.sous_dossier_id ?? '')
    || montantHt !== (piece?.montant_ht?.toString() ?? '')
    || montantTva !== (piece?.montant_tva?.toString() ?? '')
    || montantTtc !== (piece?.montant_ttc?.toString() ?? '')
    || devise !== (piece?.devise ?? DEVISE_PIVOT)
    || montantDevise !== (piece?.montant_devise ?? null)
    || tauxChange !== (piece?.taux_change ?? null)
    || notes !== (piece?.notes ?? '')
  useEffect(() => { onModifiee?.(modifiee) }, [modifiee, onModifiee])
  // Démontée — remplacée, fermée —, elle n'a plus rien à protéger.
  useEffect(() => () => onModifiee?.(false), [onModifiee])

  // Aperçu : le fichier fraîchement choisi se prévisualise localement (pas besoin de l'uploader
  // d'abord) ; le fichier déjà en storage passe par une URL signée temporaire, le bucket n'étant pas
  // public. On révoque l'URL locale à chaque changement pour ne pas fuiter de mémoire.
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      setPreviewError(null)
      return () => URL.revokeObjectURL(url)
    }
    if (piece?.storage_path) {
      let annule = false
      supabase.storage.from('pieces').createSignedUrl(piece.storage_path, 300).then(({ data, error }) => {
        if (annule) return
        if (error || !data) {
          setPreviewError("Aperçu indisponible.")
          setPreviewUrl(null)
        } else {
          setPreviewUrl(data.signedUrl)
          setPreviewError(null)
        }
      })
      return () => { annule = true }
    }
    setPreviewUrl(null)
  }, [file, piece?.storage_path])

  // Si ce tiers a déjà été catégorisé sur une pièce précédente — de ce dossier en priorité, sinon
  // partagée entre tous les dossiers (voir lib/tiersCategories.ts) — on reprend la même catégorie
  // automatiquement, sans écraser un choix déjà fait manuellement.
  function suggestCategorieFromTiers(value: string) {
    if (categorieId || !value.trim()) return
    const suggestion = suggererCategorie(value, tiersCategories, tiersCategoriesCabinet)
    if (suggestion) setCategorieId(suggestion)
  }

  // « Proposer une catégorie » — le contrat vit dans lib/categorisationIa.ts : une liste fermée, un
  // extrait retrouvé dans le document, et RIEN d'écrit. La proposition remplit au plus le champ, sur
  // un second clic ; l'enregistrement reste celui de la fiche.
  //
  // Verrou en `useRef`, posé avant le `try` et relâché dans le `finally` (CLAUDE.md) : chaque clic
  // est un appel au modèle FACTURÉ, et deux clics du même rendu passeraient un état React.
  const propositionEnCours = useRef(false)
  async function proposer() {
    if (!piece || propositionEnCours.current) return
    propositionEnCours.current = true
    const pourType = typePiece
    setProposant(true)
    setErreurProposition(null)
    setProposition(null)
    try {
      const resultat = await proposerCategorie(piece.id, pourType)
      setProposition({ pourType, resultat })
    } catch (err) {
      setErreurProposition(messageErreur(err, 'La proposition n’a pas pu être obtenue.'))
    } finally {
      propositionEnCours.current = false
      setProposant(false)
    }
  }

  function recalcFromHtTva(ht: string, tva: string) {
    const htN = parseFloat(ht)
    const tvaN = parseFloat(tva)
    if (!Number.isNaN(htN) && !Number.isNaN(tvaN)) {
      setMontantTtc((htN + tvaN).toFixed(2))
    }
  }

  async function handleExtract() {
    setExtracting(true)
    setExtractionError(null)
    setConfiance(null)
    setLignesBrutes(undefined)
    setSuggestionAutre(null)
    try {
      // Fichier fraîchement choisi, ou téléchargement du fichier déjà attaché en édition.
      let source: Blob
      let name: string
      if (file) {
        source = file
        name = file.name
      } else if (piece?.storage_path) {
        const { data, error } = await supabase.storage.from('pieces').download(piece.storage_path)
        if (error || !data) throw new Error("Impossible de récupérer le fichier existant.")
        source = data
        name = piece.nom_fichier
      } else {
        throw new Error('Dépose un fichier avant de lancer l\'extraction.')
      }

      const result = await extractPiece(source, name)

      if (result.date_piece) setDatePiece(result.date_piece)
      if (result.tiers) {
        setTiers(result.tiers)
        suggestCategorieFromTiers(result.tiers)
      }
      // La devise se pose AVANT les montants, et les montants lus sont convertis s'il le faut : ils
      // sortent de l'extraction dans la devise du document, alors que les champs de ce formulaire —
      // comme les colonnes en base — sont en euros. Les recopier tels quels ferait entrer des dollars
      // dans la comptabilité, à un montant parfaitement plausible.
      const lue = (deviseDuTexte(result.texte_ocr) ?? DEVISE_PIVOT).toUpperCase()
      const enDevise = { montant_ht: result.montant_ht, montant_tva: result.montant_tva, montant_ttc: result.montant_ttc }
      const trouve = lue === DEVISE_PIVOT ? null : await tauxBce(lue, result.date_piece ?? datePiece)
      const montants = trouve ? convertirMontants(enDevise, trouve.taux) : enDevise

      setDevise(lue)
      setMontantDevise(lue === DEVISE_PIVOT ? null : result.montant_ttc ?? null)
      setTauxChange(trouve?.taux ?? null)
      setDateTaux(trouve?.date ?? null)
      setConversionSource(trouve ? 'bce' : null)
      if (lue !== DEVISE_PIVOT && !trouve) {
        setConversionErreur(`Document en ${lue}, mais aucun taux BCE n'a pu être obtenu — les montants restent à convertir.`)
      }

      if (montants.montant_ht != null) setMontantHt(montants.montant_ht.toString())
      if (montants.montant_tva != null) setMontantTva(montants.montant_tva.toString())
      if (montants.montant_ttc != null) setMontantTtc(montants.montant_ttc.toString())
      setConfiance(result.confiance)
      if (result._lignes_brutes) setLignesBrutes(result._lignes_brutes)
      // Un bordereau de télétransmission est une pièce, mais dans l'autre sens : ce que le praticien a
      // facturé. Le sens connu est APPLIQUÉ plutôt que suggéré (voir CLAUDE.md, « une valeur par
      // défaut connue s'applique ») — laissé sur « Achat », le montant part en charge et la recette
      // qu'il justifie n'est comptée nulle part. L'utilisateur garde le sélecteur pour corriger.
      const classification = result.classification
      if (classification === 'facture_vente') {
        setTypePiece('vente')
        setSuggestionAutre("Ce document est un bordereau de télétransmission : un justificatif de RECETTE, pas une dépense. Le type est passé à « Vente » — la date à retenir reste celle de l'encaissement si elle diffère.")
      } else if (classification !== 'facture') {
        const labels: Record<Exclude<typeof classification, 'facture' | 'facture_vente'>, string> = {
          releve_bancaire: 'un relevé bancaire',
          cotisation: 'un appel de cotisation',
          attestation: 'une attestation/certificat',
          // Relevé d'activité de l'Assurance Maladie, relevé de situation d'un contrat d'épargne :
          // des états, jamais une dépense. Le montant qu'on y lit est un capital ou un chiffre
          // d'activité, et le porter en charge fausse la déclaration de son montant entier.
          autre: "un relevé d'activité ou de situation (ni une facture, ni une dépense)",
        }
        setSuggestionAutre(`Ce document ressemble plutôt à ${labels[classification]} qu'à une facture — l'onglet Documents serait peut-être plus adapté.`)
      }
    } catch (err) {
      setExtractionError(messageErreur(err, "L'extraction automatique a échoué — remplis le formulaire à la main."))
    } finally {
      setExtracting(false)
    }
  }

  async function uploadFile(): Promise<string | null> {
    if (!file) return piece?.storage_path ?? null
    const path = `${dossierId}/${Date.now()}-${slugify(file.name)}`
    const { error } = await supabase.storage.from('pieces').upload(path, file)
    if (error) throw error
    return path
  }

  // Refait la conversion au taux BCE de la date actuellement saisie. Le seul geste offert sur le
  // change : le taux n'est pas modifiable à la main, parce qu'un taux inventé ne se justifie pas, et
  // la devise non plus — elle est lue sur le document.
  async function reconvertir() {
    if (devise === DEVISE_PIVOT || montantDevise == null) return
    if (!datePiece) {
      setConversionErreur('Renseigne la date de la pièce : le taux dépend du jour.')
      return
    }
    setConversionEnCours(true)
    setConversionErreur(null)
    try {
      const trouve = await tauxBce(devise, datePiece)
      if (!trouve) {
        setConversionErreur(`Aucun taux BCE trouvé pour ${devise} au ${datePiece}.`)
        return
      }
      // Le TTC d'origine est la seule valeur sûre quand la pièce a déjà été convertie une fois :
      // reconvertir les montants EN EUROS déjà stockés les ferait passer deux fois par le change.
      const base = {
        montant_ht: montantHt ? Number.parseFloat(montantHt) * trouve.taux : null,
        montant_tva: montantTva ? Number.parseFloat(montantTva) * trouve.taux : null,
        montant_ttc: montantDevise,
      }
      const converti = convertirMontants(base, trouve.taux)
      setMontantHt(converti.montant_ht?.toFixed(2) ?? '')
      setMontantTva(converti.montant_tva?.toFixed(2) ?? '')
      setMontantTtc(converti.montant_ttc?.toFixed(2) ?? '')
      setTauxChange(trouve.taux)
      setDateTaux(trouve.date)
      // Reconvertir à la BCE reprend une valeur provisoire, même si la pièce avait déjà été réglée
      // sur la banque : c'est bien un retour en arrière, et le dire est le minimum.
      setConversionSource('bce')
    } finally {
      setConversionEnCours(false)
    }
  }

  // Le contrôle partagé appliqué aux valeurs EN COURS DE SAISIE, sans passer par la base : la règle
  // n'existe qu'à un seul endroit (lib/controles.ts) et cet écran ne fait que la consulter. Un champ
  // vide vaut « non renseigné » — le contrôle ne se prononce que sur ce qui est là.
  const nombreOuNull = (v: string) => (v.trim() === '' ? null : Number.parseFloat(v))
  const motifTvaSaisie = piecesTvaImpossible([{
    ...(piece ?? ({} as Piece)),
    montant_ht: nombreOuNull(montantHt),
    montant_tva: nombreOuNull(montantTva),
    montant_ttc: nombreOuNull(montantTtc),
  } as Piece])[0]?.motif ?? null

  // Verrou en `useRef`, POSÉ AVANT LE `try`. Deux raisons, et la seconde est celle qu'on oublie :
  // `saving` est un état React, donc `disabled={saving}` ne ferme rien contre deux clics dans le
  // même rendu ; et placé DANS le `try`, le `return` du deuxième clic sortirait par le `finally`,
  // qui relâcherait le verrou du PREMIER, encore en cours — il faut trois clics pour le voir
  // (CLAUDE.md).
  //
  // Le doublon crée une PIÈCE de plus sur le même justificatif, et une pièce en double est une
  // charge comptée deux fois — en 2035 comme en balance. Même famille que l'import en masse qui
  // écrivait 141 lignes pour 78 fichiers, sur le chemin à l'unité cette fois.
  const enregistrementEnCours = useRef(false)

  async function save(statut: 'a_valider' | 'validee') {
    if (enregistrementEnCours.current) return
    enregistrementEnCours.current = true
    setSaving(true)
    setError(null)
    try {
      if (statut === 'validee' && !montantTtc) {
        throw new Error('Le montant TTC est obligatoire pour valider une pièce.')
      }
      if (!piece && !file) {
        throw new Error('Merci de déposer un fichier.')
      }
      // Uniquement quand un nouveau fichier est choisi (pas en simple modification d'une pièce
      // existante sans redéposer) — même détection que l'import en masse et les autres dépôts à
      // l'unité (Documents, Cotisations).
      const hash = file ? await hashFichier(file) : null
      if (hash && (await fichierDejaPresent(dossierId, hash))) {
        throw new Error('Ce fichier est déjà présent dans ce dossier (Pièces ou Documents).')
      }
      const storagePath = await uploadFile()
      const { data: userData } = await supabase.auth.getUser()

      const payload = {
        dossier_id: dossierId,
        storage_path: storagePath,
        ...(hash ? { storage_hash: hash } : {}),
        nom_fichier: file?.name ?? piece?.nom_fichier,
        date_piece: datePiece || null,
        tiers: tiers || null,
        type_piece: typePiece,
        categorie_id: categorieId || null,
        sous_dossier_id: sousDossierId || null,
        montant_ht: montantHt ? parseFloat(montantHt) : null,
        montant_tva: montantTva ? parseFloat(montantTva) : null,
        montant_ttc: montantTtc ? parseFloat(montantTtc) : null,
        // Les trois montants ci-dessus sont en euros, toujours. Ces trois-ci disent dans quelle
        // devise le document est écrit et comment on est passé de l'un à l'autre (voir
        // lib/devises.ts) — une contrainte en base impose qu'ils soient nuls pour une pièce en euros.
        devise,
        montant_devise: devise === DEVISE_PIVOT ? null : montantDevise,
        taux_change: devise === DEVISE_PIVOT ? null : tauxChange,
        conversion_source: devise === DEVISE_PIVOT || tauxChange == null ? null : conversionSource ?? 'bce',
        notes: notes || null,
        statut,
        confiance,
      }

      if (piece) {
        const { error } = await supabase.from('pieces').update(payload).eq('id', piece.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('pieces').insert({ ...payload, uploaded_by: userData.user!.id })
        if (error) throw error
      }

      // Mémorise la correspondance tiers → catégorie pour la reproposer automatiquement la prochaine
      // fois, sur ce dossier. Best-effort : un échec ici ne doit pas remettre en cause la sauvegarde
      // de la pièce — mais il est journalisé, jamais avalé en silence (voir `memoriser`).
      if (tiers.trim() && categorieId) {
        // La règle est apprise sous l'identité du fournisseur, pas sous la graphie exacte lue par
        // l'OCR : sinon un arbitrage fait sur « Transmedical et soigner redevient » ne servirait à
        // aucune des seize autres pièces du même fournisseur. Même clé que l'écran de
        // catégorisation en masse, pour que les deux chemins alimentent le même apprentissage.
        const cleRegle = cleFournisseur(tiers) ?? normalizeTiers(tiers)
        await memoriser(
          'la règle de ce dossier',
          supabase.from('tiers_categories').upsert(
            { dossier_id: dossierId, tiers_normalise: cleRegle, categorie_id: categorieId },
            { onConflict: 'dossier_id,tiers_normalise' },
          ),
        )
        // Catégorie choisie parmi les catégories globales (dossier_id null) : la correspondance a du
        // sens au-delà de ce seul dossier (une mutuelle, une banque... reviennent souvent d'un client
        // à l'autre), donc on la mémorise aussi au niveau cabinet — voir lib/tiersCategories.ts. Une
        // catégorie propre à ce dossier reste, elle, sans équivalent chez un autre client.
        const categorieChoisie = categories.find((c) => c.id === categorieId)
        if (categorieChoisie && categorieChoisie.dossier_id === null && monCabinetId) {
          await memoriser(
            'la règle du cabinet',
            supabase.from('tiers_categories_cabinet').upsert(
              { cabinet_id: monCabinetId, tiers_normalise: cleRegle, categorie_id: categorieId },
              { onConflict: 'cabinet_id,tiers_normalise' },
            ),
          )
        }
      }

      // Enregistrée : plus rien à protéger — dit AVANT de chaîner, sinon la garde demanderait
      // d'abandonner une saisie qui vient justement d'être enregistrée.
      onModifiee?.(false)
      onSaved()
      if (statut === 'validee' && piece && onValidee) onValidee(piece.id)
      else onClose()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      enregistrementEnCours.current = false
      setSaving(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    save('validee')
  }

  async function handleDelete() {
    if (!piece) return
    if (!window.confirm(
      `Supprimer définitivement la pièce "${piece.nom_fichier}" ? Cette action est irréversible.\n\n${AVERTISSEMENT_RAPPROCHEMENT_DEFAIT}`,
    )) return
    setDeleting(true)
    setError(null)
    try {
      const { error: deleteError } = await supabase.from('pieces').delete().eq('id', piece.id)
      if (deleteError) {
        // Contrainte de clé étrangère (23503) : la pièce est encore référencée par une table qui
        // REFUSE la suppression. Gardé comme garde-fou, mais ce chemin ne peut pas se lever
        // aujourd'hui — mesuré le 23/09/2026, les cinq clés entrantes de `pieces` sont en SET NULL
        // ou CASCADE, et `packs` n'a aucune clé entrante (`pack_pieces` a été supprimée). Le message
        // d'avant nommait justement ces deux liens-là et envoyait « retirer » ce qui ne bloque rien ;
        // il ne devine donc plus la cause, il dit ce qu'on sait et rend la raison de Postgres.
        if (deleteError.code === '23503') {
          throw new Error(
            'Impossible de supprimer : cette pièce est encore référencée ailleurs dans la base. '
            + `Raison rendue par la base : ${messageErreur(deleteError, 'aucune')}`,
          )
        }
        throw deleteError
      }

      // Best-effort : le fichier au storage n'a pas besoin de bloquer la suppression de la pièce s'il
      // a déjà disparu ou si la suppression échoue pour une autre raison.
      if (piece.storage_path) {
        await retirerFichiers('pieces', [piece.storage_path], 'FichePiece')
      }

      onModifiee?.(false)
      onSaved()
      onClose()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      setDeleting(false)
    }
  }

  const genreApercu = typeApercu(file?.name ?? piece?.nom_fichier ?? '')
  const occupee = saving || deleting

  // Une pièce sans catégorie : d'abord ce que les règles apprises savent de son fournisseur, et le
  // modèle SEULEMENT pour ce qu'elles ne savent pas (CLAUDE.md, « les règles d'abord »). Une règle
  // connue ne coûte rien ; le modèle, un appel facturé.
  const regle = suggererCategorie(tiers, tiersCategories, tiersCategoriesCabinet)
  const categorieRegle = regle ? categories.find((c) => c.id === regle) ?? null : null
  const propositionAffichee = proposition && proposition.pourType === typePiece ? proposition.resultat : null
  const categorieProposee = propositionAffichee?.categorieId
    ? categories.find((c) => c.id === propositionAffichee.categorieId) ?? null
    : null
  const messageProposition = !propositionAffichee || categorieProposee
    ? null
    : propositionAffichee.issue === 'retenue'
      // L'identifiant rendu n'est pas dans la liste de la fiche : une catégorie créée ou retirée depuis
      // l'ouverture de l'écran. La poser dans le champ enregistrerait une valeur que le champ n'affiche pas.
      ? 'La catégorie proposée n’est pas dans la liste de ce dossier : rechargez la page, puis réessayez.'
      : libelleIssue(propositionAffichee.issue)

  return (
    <div className="fiche-piece">
      <EntetePanneau
        titre={navigation?.position ?? (piece ? 'Justificatif' : 'Ajouter une pièce')}
        sousTitre={piece ? (tiers.trim() || piece.nom_fichier) : null}
        actions={navigation && (
          <>
            {/* Grisés pendant un enregistrement : la fiche changerait de pièce sous une réponse
                encore attendue, et l'enchaînement qui suit une validation partirait de la mauvaise. */}
            <button
              type="button"
              className="panneau-bouton-icone"
              onClick={navigation.precedente ?? undefined}
              disabled={!navigation.precedente || occupee}
              aria-label="Justificatif précédent"
              title="Justificatif précédent"
            >
              <IconPrecedent width={18} height={18} />
            </button>
            <button
              type="button"
              className="panneau-bouton-icone"
              onClick={navigation.suivante ?? undefined}
              disabled={!navigation.suivante || occupee}
              aria-label="Justificatif suivant"
              title="Justificatif suivant"
            >
              <IconChevron width={18} height={18} />
            </button>
          </>
        )}
        onFermer={onClose}
      />
      {/* Corps qui défile, pied fixe : sur un justificatif long (PDF), les boutons d'action
          restaient sinon hors champ tant qu'on n'avait pas fait défiler tout le formulaire. */}
      <form onSubmit={handleSubmit} className="fiche-piece-formulaire">
        <div className="fiche-piece-corps">
          {(previewUrl || previewError) && (
            <div className="field fiche-piece-apercu">
              {previewError ? (
                <p className="muted" style={{ margin: 0 }}>{previewError}</p>
              ) : (
                <>
                  {genreApercu === 'image' && <img src={previewUrl!} alt="Aperçu de la pièce" />}
                  {genreApercu === 'pdf' && <iframe src={previewUrl!} title="Aperçu de la pièce" />}
                  <a href={previewUrl!} target="_blank" rel="noreferrer" className="muted">
                    Ouvrir dans un nouvel onglet ↗
                  </a>
                </>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="file">{piece ? 'Remplacer le fichier' : 'Fichier'}</label>
            <input id="file" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setConfiance(null); setExtractionError(null) }} />
            {piece && !file && <span className="muted">Actuel : {piece.nom_fichier}</span>}
          </div>

          <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={extracting || (!file && !piece?.storage_path)}
              onClick={handleExtract}
            >
              {extracting ? 'Extraction…' : '✨ Extraire automatiquement'}
            </button>
            {confiance && (
              <span className={`badge ${confiance === 'haute' ? 'badge-ok' : confiance === 'moyenne' ? 'badge-warning' : 'badge-neutral'}`}>
                Confiance {confiance} — vérifie les champs
              </span>
            )}
          </div>
          {extractionError && <p className="error-text" style={{ marginTop: -8 }}>{extractionError}</p>}
          {suggestionAutre && <p className="muted" style={{ marginTop: -8 }}>💡 {suggestionAutre}</p>}

          {lignesBrutes && (
            <details className="field" style={{ marginTop: -8 }}>
              <summary className="muted" style={{ cursor: 'pointer' }}>TVA introuvable — diagnostic (temporaire), clique pour copier</summary>
              <pre style={{ fontSize: '0.75rem', background: 'var(--color-bg)', padding: 8, borderRadius: 8, overflowX: 'auto', userSelect: 'all' }}>
                {lignesBrutes.join('\n')}
              </pre>
            </details>
          )}

          <div className="field-row">
            <div className="field">
              <label htmlFor="date">Date de la pièce</label>
              <input id="date" type="date" value={datePiece} onChange={(e) => setDatePiece(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="type">Type</label>
              <select id="type" value={typePiece} onChange={(e) => setTypePiece(e.target.value as TypePiece)}>
                <option value="achat">Achat</option>
                <option value="vente">Vente</option>
                <option value="note_frais">Note de frais</option>
                <option value="autre">Autre</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="tiers">Tiers (fournisseur / client)</label>
            <input
              id="tiers"
              list="tiers-connus"
              value={tiers}
              onChange={(e) => setTiers(e.target.value)}
              onBlur={(e) => suggestCategorieFromTiers(e.target.value)}
            />
            <datalist id="tiers-connus">
              {tiersConnus.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="categorie">Catégorie</label>
              <select id="categorie" value={categorieId} onChange={(e) => setCategorieId(e.target.value)}>
                <option value="">— Choisir —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sousDossier">Sous-dossier</label>
              <select id="sousDossier" value={sousDossierId} onChange={(e) => setSousDossierId(e.target.value)}>
                <option value="">— Aucun —</option>
                {sousDossiers.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
              </select>
            </div>
          </div>

          {piece && !categorieId && (categorieRegle ? (
            <div className="proposition-categorie">
              <p>Une règle apprise range ce fournisseur en <strong>{categorieRegle.libelle}</strong>.</p>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setCategorieId(categorieRegle.id)}>
                Appliquer
              </button>
            </div>
          ) : !regle && !sansTexteLu && (
            <div className="proposition-categorie">
              {categorieProposee && propositionAffichee ? (
                <>
                  <p>
                    Proposée : <strong>{categorieProposee.libelle}</strong>, parce que le document porte
                    {' '}« {propositionAffichee.indice} ».
                    <span className="muted"> L’extrait figure bien sur le document ; c’est à vous de juger s’il justifie la catégorie.</span>
                  </p>
                  <div className="proposition-categorie-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setCategorieId(categorieProposee.id)}>
                      Appliquer
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setProposition(null)}>
                      Écarter
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-outline btn-sm" disabled={proposant} onClick={proposer}>
                    {proposant ? 'Proposition…' : '✨ Proposer une catégorie'}
                  </button>
                  {messageProposition && <p className="muted">{messageProposition}</p>}
                  {erreurProposition && <p className="error-text">{erreurProposition}</p>}
                </>
              )}
            </div>
          ))}

          <div className="field-row fiche-piece-montants">
            <div className="field">
              <label htmlFor="ht">Montant HT</label>
              <input id="ht" type="number" step="0.01" value={montantHt} onChange={(e) => { setMontantHt(e.target.value); recalcFromHtTva(e.target.value, montantTva) }} />
            </div>
            <div className="field">
              <label htmlFor="tva">TVA</label>
              <input id="tva" type="number" step="0.01" value={montantTva} onChange={(e) => { setMontantTva(e.target.value); recalcFromHtTva(montantHt, e.target.value) }} />
            </div>
            <div className="field">
              <label htmlFor="ttc">Montant TTC</label>
              <input id="ttc" type="number" step="0.01" value={montantTtc} onChange={(e) => setMontantTtc(e.target.value)} />
            </div>
          </div>

          {/* Au-dessus des trois montants : ils sont en EUROS, et le document dit autre chose.
              Sans cette ligne, on croit relire la facture alors qu'on lit sa conversion. */}
          {devise !== DEVISE_PIVOT && (
            <div className="bloc-devise">
              <div>
                <strong>Document en {devise}</strong>
                {tauxChange != null && montantDevise != null ? (
                  <span className="muted">
                    {' — '}{libelleConversion(montantDevise, devise, tauxChange, dateTaux ?? datePiece)}.
                    {' '}Les montants ci-dessous sont le résultat de cette conversion, en euros.
                    {' '}{conversionSource === 'banque'
                      ? 'Montant DÉFINITIF : repris du mouvement bancaire qui a payé la pièce, frais de change compris.'
                      : 'Montant PROVISOIRE : il sera remplacé par ce que la banque a réellement débité, au rapprochement.'}
                  </span>
                ) : (
                  <span className="muted">
                    {' — '}non convertie : aucun taux BCE n'a pu être obtenu au dépôt.
                    {montantDevise != null && ` Montant lu sur le document : ${montantDevise.toFixed(2)} ${devise}.`}
                  </span>
                )}
              </div>
              <button type="button" className="btn btn-outline btn-sm" disabled={conversionEnCours || montantDevise == null} onClick={reconvertir}>
                {conversionEnCours ? 'Conversion…' : `Convertir au taux du ${datePiece || '…'}`}
              </button>
              {conversionErreur && <p className="alerte-tva" style={{ margin: 0 }}>{conversionErreur}</p>}
            </div>
          )}

          {/* Sous les trois champs, et calculé en direct : c'est l'endroit et le moment où la
              personne a le document sous les yeux. La règle n'est pas réécrite ici — c'est le
              contrôle partagé qui tranche (voir lib/controles.ts), appliqué aux valeurs en
              cours de saisie plutôt qu'à la pièce enregistrée. */}
          {motifTvaSaisie && (
            <p className="alerte-tva">
              <strong>TVA impossible :</strong> {LIBELLE_MOTIF_TVA[motifTvaSaisie]}. Ces montants
              ne peuvent pas être ceux du document — la TVA lue part telle quelle en déduction.
            </p>
          )}

          <div className="field">
            <label htmlFor="notes">Notes internes</label>
            <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <p className="muted" style={{ fontSize: '0.78rem', margin: '4px 0 0' }}>
              Pour le cabinet seul. Les précisions échangées avec le client sont plus bas.
            </p>
          </div>

          {/* Le fil client/cabinet, à côté du document plutôt que dans un onglet à part : c'est
              en regardant la facture qu'on a besoin de savoir ce que le client en a dit. Une
              pièce pas encore enregistrée n'a pas d'identifiant, donc rien à quoi rattacher un
              commentaire — le fil n'apparaît qu'une fois la pièce créée. */}
          {piece && (
            <div className="field">
              <label>Précisions du client</label>
              <FilCommentaires
                dossierId={dossierId}
                cible={{ type: 'piece', id: piece.id }}
                commentaires={commentaires}
                estCabinet
                onAjout={(c) => { setCommentaires((prev) => [...prev, c]); onCommentaireAjoute(c) }}
                onSuppression={(id) => {
                  setCommentaires((prev) => prev.filter((c) => c.id !== id))
                  onCommentaireSupprime(id)
                }}
              />
            </div>
          )}

          {rapprochee && <p className="fiche-piece-rapprochee">Rapprochée avec un mouvement bancaire.</p>}

          {error && <p className="error-text">{error}</p>}
        </div>

        <div className="fiche-piece-pied">
          {piece ? (
            <button type="button" className="btn btn-danger btn-sm" disabled={occupee} onClick={handleDelete}>
              {deleting ? 'Suppression…' : 'Supprimer'}
            </button>
          ) : <span />}
          <div className="fiche-piece-actions">
            <button type="button" className="btn btn-outline btn-sm" disabled={occupee} onClick={() => save('a_valider')}>
              Enregistrer brouillon
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={occupee}>
              {saving ? 'Enregistrement…' : 'Valider'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
