import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, formatDate, formatMoney } from '../../lib/format'
import { COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE, COMPTE_TVA_IMMOBILISATIONS } from '../../lib/comptes'
import {
  SUGGESTIONS_COMPTE_PAR_CODE, analyserEcritures, ecrituresAGenerer, ecrituresSansObjet, lignesOuvertes, lignesPourPiece, piecesAComptabiliser,
  soldeCompte,
} from '../../lib/ecritures'
import type { EcritureSansObjet, MotifSansObjet, SuiteDansUnExerciceValide } from '../../lib/ecritures'
import { COMPTES_NOTES_DE_FRAIS, EXPLICATIONS_MODE, LIBELLES_MODE, type ModeleComptable } from '../../lib/engagement'
import { LIBELLE_MOTIF_TVA, categoriesSansCompte as calculerCategoriesSansCompte, piecesSansTva as calculerPiecesSansTva, piecesTvaImpossible, piecesValideesSansCategorie } from '../../lib/controles'
import { formaterFec, genererFec, nomFichierFec, numerotationValidee, telechargerTexte } from '../../lib/fec'
import { etatsDesLettragesManuels, lettrages, piecesLettreesALaMain } from '../../lib/lettrage'
import { estFigee } from '../../lib/validationExercice'
import { lireTout } from '../../lib/lectureComplete'
import { absenceFec, genererPisteAuditCsv, nomFichierPisteAudit, pisteAudit, rupturesPisteAudit } from '../../lib/pisteAudit'
import { anneesDesRattachements, paiementsDesPieces, rattachements } from '../../lib/rattachement'
import {
  ecritureDuMouvement, idsMouvementsJustifiesParLeReleve, mouvementsAffectes, mouvementsAffectesDesynchronises, refusAffectation,
  type MouvementAffecte,
} from '../../lib/affectationBanque'
import type {
  ANouveau, Categorie, CompteNotesDeFrais, EcritureBrouillon, Immobilisation, LettrageManuel, LigneBancaire, ModeComptable, NatureImmobilisation, Piece,
  ReglementGroupe, VehiculeDossier, VentilationBancaire,
} from '../../lib/types'
import { acquisitionsDesBiens } from '../../lib/amortissements'
import { ecritureDeLaVentilation, mouvementsVentilesDesynchronises, partsAReecrire, refusVentilation } from '../../lib/ventilationBanque'
import { libelleTaux } from '../../lib/tvaDuReleve'
import { compteDuDirigeant } from '../../lib/virementPersonnel'
import BrouillonBanner from '../../components/BrouillonBanner'
import BarreRecherche from '../../components/BarreRecherche'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { correspondALaRecherche } from '../../lib/recherche'
import { useAnnee } from '../../context/AnneeContext'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import { messageErreur } from '../../lib/messageErreur'

// Ce qui a changé sur la pièce, et ce que le cabinet doit faire — jamais corrigé d'office :
// retirer une écriture est un arbitrage comptable, et les trois derniers motifs se réparent en
// AMONT (sur la pièce), après quoi « Régénérer » reprend la bonne écriture.
const LIBELLE_MOTIF_SANS_OBJET: Record<MotifSansObjet, string> = {
  bien_sans_nature: "Enregistrée en immobilisation, sans nature : son compte d'immobilisation n'est pas connu",
  bien_repris: "Bien acquis avant l'ouverture du dossier : la balance reprise porte déjà sa valeur",
  sans_categorie: 'La catégorie a été retirée',
  categorie_sans_compte: "La catégorie n'a plus de compte comptable",
  sans_montant: 'Le montant TTC a été effacé',
}

const ACTION_MOTIF_SANS_OBJET: Record<MotifSansObjet, string> = {
  bien_sans_nature: "Le FEC et la balance la portent en charge, alors que le bien s'amortit. Choisir sa nature dans l'onglet Immobilisations, puis régénérer : l'écriture passe sur le compte du bien. Ou retirer l'écriture ci-contre — ou l'immobilisation, si c'en est une par erreur.",
  bien_repris: "Le FEC et la balance le comptent une seconde fois — ou en charge, si l'écriture précède son inscription au registre. Retirer l'écriture ci-contre : les à-nouveaux portent son acquisition, et ses dotations s'écrivent à partir de l'ouverture.",
  sans_categorie: "Redonner une catégorie à la pièce depuis Justificatifs, puis régénérer l'écriture.",
  categorie_sans_compte: 'Renseigner le compte de la catégorie ci-dessous, puis régénérer.',
  sans_montant: 'Remettre le montant TTC de la pièce depuis Justificatifs, puis régénérer.',
}

// Palier 5 — brouillon comptable, brique 1 (journal). Génère une proposition d'écriture pour
// chaque pièce validée dont la catégorie a un compte associé — la ligne charge/produit, puis la
// ligne de TVA séparée le cas échéant (brique 3). La contrepartie banque (partie double complète,
// voir lib/ecritures.ts) s'ajoute automatiquement si la pièce est déjà rapprochée d'un mouvement au
// moment de la génération, ou plus tard depuis Banque sinon. L'export FEC (voir lib/fec.ts) permet au
// cabinet de récupérer un fichier directement importable dans son propre logiciel de comptabilité,
// une fois l'année sélectionnée et le brouillon jugé complet.
// Le modèle comptable du dossier (lib/engagement.ts) se règle ICI, là où il sert, et seulement tant que
// le brouillon est vide : il décide des comptes de toutes les écritures, et la base refuse ensuite de
// le changer (déclencheur `verrouiller_modele_comptable`).
// Ce que la génération dit d'une pièce datée d'un exercice validé (lib/ecritures.ts, `ecrituresAGenerer`) : une
// phrase par cas, pour ne rien promettre que le code ne fera pas — seule une part qui attend son paiement s'écrira.
const CE_QUI_S_ECRIT: Record<SuiteDansUnExerciceValide, (frontiere: string) => string> = {
  partielle: (frontiere) => `Seule sa part datée après le ${frontiere}.`,
  a_payer: (frontiere) => `Rien pour l’instant : ce qui reste à payer s’écrira à la date de son paiement, s’il est rapproché après le ${frontiere}.`,
  note_de_frais: () => 'Rien : une note de frais compte à sa date, qui tombe dans un exercice validé.',
  payee: () => 'Rien : elle a été payée dans un exercice validé.',
  facture: () => 'Rien : sa facture tombe dans un exercice validé.',
}

export default function EcrituresTab({ dossierId, dossierNom, dossierSiret, assujettiTva, modele, onModeleUpdated }: {
  dossierId: string
  dossierNom: string
  dossierSiret: string | null
  assujettiTva: boolean
  modele: ModeleComptable
  onModeleUpdated: (modification: { mode_comptable?: ModeComptable; compte_notes_de_frais?: CompteNotesDeFrais }) => void
}) {
  const [categories, setCategories] = useState<Categorie[]>([])
  const [piecesValidees, setPiecesValidees] = useState<Piece[]>([])
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  // L'ouverture d'un dossier repris d'un autre logiciel (voir lib/aNouveaux.ts) : elle ouvre le FEC et
  // la piste d'audit de l'exercice qu'elle ouvre.
  const [aNouveaux, setANouveaux] = useState<ANouveau[]>([])
  const [lignesBancaires, setLignesBancaires] = useState<LigneBancaire[]>([])
  // Les parts des virements qui règlent PLUSIEURS pièces (lib/reglementGroupe.ts) : chacune est un
  // paiement de sa pièce, qui date sa charge et porte sa contrepartie banque comme un rapprochement simple.
  const [reglements, setReglements] = useState<ReglementGroupe[]>([])
  // Les parts des mouvements ventilés (lib/ventilationBanque.ts) : de quoi dire une écriture qui ne les
  // suit plus, et la réécrire. À part de `brouillonIncomplet` : le FEC et la piste d'audit n'en dépendent
  // pas — l'écriture d'un mouvement ventilé est au brouillon, et le prédicat du relevé se lit sur la ligne.
  const [ventilations, setVentilations] = useState<VentilationBancaire[]>([])
  const [ventilationsIncompletes, setVentilationsIncompletes] = useState<string | null>(null)
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  // Les natures des biens : la facture d'un bien s'écrit sur le compte d'immobilisation de sa nature
  // (l'écriture d'ACQUISITION, lib/amortissements.ts, `acquisitionsDesBiens`).
  const [natures, setNatures] = useState<NatureImmobilisation[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comptesEdit, setComptesEdit] = useState<Record<string, string>>({})
  const [recherche, setRecherche] = useState('')
  // Exercice partagé avec Pièces/Banque/Statistiques/Clôture, sélectionné dans l'en-tête du dossier
  // (voir AnneeContext) — pas de sélecteur local ici.
  const { annee: anneeFilter } = useAnnee()
  // Ce que les exercices validés ont figé (lib/validationExercice.ts) : la base refuse d'y écrire, de le modifier
  // ou de le retirer, donc les contrôles ne le comparent plus et aucun geste ne le propose.
  const { frontiere, exercices: exercicesValides } = useExercicesValides()
  const [regenerating, setRegenerating] = useState<string | null>(null)
  const [retrait, setRetrait] = useState<string | null>(null)
  const [exportPiste, setExportPiste] = useState(false)
  // Non nul quand le brouillon n'a PAS pu être lu en entier (voir lib/lectureComplete.ts). PostgREST
  // plafonne le nombre de lignes rendues par requête sans le signaler : au-delà, cet écran
  // afficherait un sous-ensemble, et le FEC comme la piste d'audit partiraient amputés sans qu'un
  // seul signal ne paraisse. Le format FEC étant rigide, il ne peut pas porter l'avertissement —
  // l'export se refuse donc, plutôt que de produire un fichier fiscal faux.
  const [brouillonIncomplet, setBrouillonIncomplet] = useState<string | null>(null)
  // À PART du drapeau précédent, et c'est le point : une ouverture lue à moitié ouvrirait le FEC et la
  // piste d'audit amputés, mais la génération des écritures n'en dépend que pour la facture d'un BIEN —
  // c'est l'ouverture qui dit s'il est repris (voir `biensSansOuverture`). La suspendre pour toutes les
  // pièces bloquerait un geste que rien ne fausse.
  const [aNouveauxIncomplets, setANouveauxIncomplets] = useState<string | null>(null)
  // Les lettrages faits à la main (ligne 32, seconde brique) : une facture et l'avoir qui la solde, que le FEC lettre
  // ensemble. À PART encore : lus en partie, ils ne faussent ni la génération ni la piste d'audit, mais le FEC d'un
  // dossier en engagement laisserait ouverte une facture que le cabinet a lettrée, sans pouvoir le dire.
  const [lettragesManuels, setLettragesManuels] = useState<LettrageManuel[]>([])
  const [lettragesIncomplets, setLettragesIncomplets] = useState<string | null>(null)
  // Verrou d'exécution de la génération : `generating` est un état React, qui ne prend effet qu'au
  // rendu suivant — un double clic du même rendu passerait les deux, et chaque pièce en attente
  // recevrait deux jeux d'écritures, c'est-à-dire sa charge en double dans le FEC et la balance.
  const generationEnCours = useRef(false)
  // Le changement de modèle et la génération s'excluent : une génération partie avec l'ancien modèle
  // pendant que le nouveau s'enregistre écrirait des écritures de trésorerie dans un dossier passé en
  // engagement. Chacun regarde le verrou de l'autre.
  const changementModeleEnCours = useRef(false)
  const [changementModele, setChangementModele] = useState(false)
  // Par pièce : régénérer, c'est supprimer puis réécrire, et deux clics du même rendu réécriraient deux
  // fois — en engagement, la facture ET ses règlements en double.
  const regenerationsEnCours = useRef<Set<string>>(new Set())
  // Par mouvement, pour la même raison : réaffecter remplace l'écriture d'un mouvement affecté, réécrire
  // celle d'un mouvement ventilé — un mouvement n'est jamais les deux.
  const reaffectationsEnCours = useRef<Set<string>>(new Set())
  const [reaffectation, setReaffectation] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [
      lectureCategories, lecturePieces, brouillon, lectureImmobilisations, lectureLignes, lectureANouveaux, lectureVentilations,
      lectureReglements, lectureNatures, lectureLettrages,
    ] = await Promise.all([
      lireTout<Categorie>((debut, fin) =>
        supabase.from('categories').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre').order('id').range(debut, fin),
      ),
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
      ),
      // Lue par tranches, et triée sur un ordre TOTAL (`date` n'est pas unique) : sans clé de
      // départage, deux tranches successives peuvent se recouvrir ou sauter des lignes, et rien ne
      // le signale.
      lireTout<EcritureBrouillon>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date', { ascending: false }).order('id').range(debut, fin),
      ),
      // Paginée comme le reste : cette liste EXCLUT du brouillon les pièces devenues des actifs.
      // Tronquée, elle laisserait générer une charge sur une immobilisation — exactement ce que
      // `ecrituresSansObjet` signale ensuite, mais produit par la lecture plutôt que par un geste. Et
      // elle nomme le bien d'une dotation aux amortissements dans la piste d'audit, avec sa facture.
      lireTout<Immobilisation>((debut, fin) =>
        supabase.from('immobilisations').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Les mouvements RAPPROCHÉS : ceux d'une pièce datent et règlent son écriture, ceux AFFECTÉS à une
      // catégorie sans justificatif (ligne 26.6) portent la leur — sans pièce, et ce n'est pas une
      // rupture de la piste d'audit. Tous, et pas seulement ceux d'une pièce : les laisser dehors ferait
      // sortir leurs écritures du FEC et les signaler « sans justificatif ». Et les VIREMENTS PERSONNELS,
      // classés « ignorés » mais écrits sur le compte du dirigeant (lib/virementPersonnel.ts), pour la
      // même raison.
      lireTout<LigneBancaire>((debut, fin) =>
        supabase.from('lignes_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).or('statut.eq.rapprochee,prelevement_personnel.eq.true')
          .order('id').range(debut, fin),
      ),
      lireTout<ANouveau>((debut, fin) =>
        supabase.from('a_nouveaux').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('compte').order('id').range(debut, fin),
      ),
      lireTout<VentilationBancaire>((debut, fin) =>
        supabase.from('ventilations_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Les parts des virements groupés : elles datent et règlent l'écriture de leurs pièces, comme les
      // mouvements ci-dessus — donc le même drapeau, qui suspend la génération et les deux exports.
      lireTout<ReglementGroupe>((debut, fin) =>
        supabase.from('reglements_groupes').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Celles du dossier ET celles du cabinet (`dossier_id` nul) : ce sont presque toutes des natures
      // partagées, et un filtre sur le seul dossier les écarterait toutes — chaque bien paraîtrait sans
      // nature, donc sans compte, et son acquisition ne s'écrirait pas.
      lireTout<NatureImmobilisation>((debut, fin) =>
        supabase.from('natures_immobilisation').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
      ),
      lireTout<LettrageManuel>((debut, fin) =>
        supabase.from('lettrages_manuels').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
    ])
    setLignesBancaires(lectureLignes.lignes)
    setLettragesManuels(lectureLettrages.lignes)
    setLettragesIncomplets(lectureLettrages.motif)
    setReglements(lectureReglements.lignes)
    setVentilations(lectureVentilations.lignes)
    setVentilationsIncompletes(lectureVentilations.complete ? null : lectureVentilations.motif)
    setCategories(lectureCategories.lignes)
    setPiecesValidees(lecturePieces.lignes)
    setEcritures(brouillon.lignes)
    setANouveaux(lectureANouveaux.lignes)
    // Un seul drapeau pour TOUTES les collections dont dépendent le FEC et la piste d'audit, et
    // l'écran n'a rien de plus utile à dire selon laquelle a manqué. Les catégories, les
    // immobilisations et leurs natures en font partie : la première décide du compte de chaque
    // écriture, les deux autres de quelles pièces s'écrivent sur le compte d'un bien — une nature non
    // lue ferait passer son bien pour un bien sans nature, dont l'acquisition ne s'écrit pas.
    setBrouillonIncomplet(
      [brouillon, lecturePieces, lectureLignes, lectureReglements, lectureCategories, lectureImmobilisations, lectureNatures]
        .find((l) => !l.complete)?.motif ?? null,
    )
    setANouveauxIncomplets(lectureANouveaux.motif)
    setImmobilisations(lectureImmobilisations.lignes)
    setNatures(lectureNatures.lignes)
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  // La pièce de chaque bien du registre, et ce que sa facture écrit : le compte d'immobilisation de sa
  // nature — ou rien, pour un bien sans nature, et pour un bien acquis avant l'ouverture d'un dossier
  // repris, que les à-nouveaux portent déjà (lib/amortissements.ts). Une seule ouverture par dossier, la
  // base le garantit : la date de n'importe quel à-nouveau est la sienne.
  const ouverture = aNouveaux[0]?.date ?? null
  const acquisitions = acquisitionsDesBiens(immobilisations, natures, ouverture)
  const pieceIdsImmobilisees = new Set(acquisitions.keys())

  // Catégories utilisées par au moins une pièce validée, un mouvement affecté ou une part d'un mouvement
  // ventilé mais sans compte associé — impossible de générer l'écriture correspondante tant que ce n'est
  // pas renseigné (voir lib/controles.ts). La facture d'un bien n'y compte pas : elle s'écrit sur le
  // compte de sa nature.
  const categoriesSansCompte = calculerCategoriesSansCompte(
    categories, piecesValidees, [...lignesBancaires, ...ventilations], pieceIdsImmobilisees,
  )

  // Valeur affichée dans le champ tant que le cabinet n'a rien tapé : la suggestion connue pour ce
  // code de catégorie, sinon vide — jamais enregistrée avant le clic explicite sur "Enregistrer".
  function compteAffiche(c: Categorie): string {
    return comptesEdit[c.id] ?? SUGGESTIONS_COMPTE_PAR_CODE[c.code]?.compte ?? ''
  }

  // UN NUMÉRO DE COMPTE COMMENCE PAR TROIS CHIFFRES. Ce champ est le seul endroit de l'application où
  // un compte se tape à la main, et il part tel quel dans chaque écriture puis dans le FEC. L'outil de
  // contrôle de la DGFiP (Test Compta Demat) y refuse un CompteNum dont les trois premiers caractères
  // ne sont pas des chiffres ; la suite peut porter des lettres (« 401AE » dans la notice de l'arrêté).
  // Les espaces sont retirées : « 606 100 » se tape, mais aucun compte n'en contient.
  async function saveCompte(categorieId: string) {
    setError(null)
    const categorie = categories.find((c) => c.id === categorieId)
    const valeur = (comptesEdit[categorieId] ?? (categorie ? SUGGESTIONS_COMPTE_PAR_CODE[categorie.code]?.compte : undefined) ?? '').replace(/\s+/g, '')
    if (!valeur) return
    if (!/^\d{3}/.test(valeur)) {
      setError(`« ${valeur} » n'est pas un numéro de compte : il commence par trois chiffres, comme 606100. Le fichier des écritures (FEC) n'en accepte pas d'autre.`)
      return
    }
    const { error: saveError } = await supabase.from('categories').update({ compte_comptable: valeur }).eq('id', categorieId)
    if (saveError) {
      setError(saveError.message)
      return
    }
    load()
  }

  // Ce que chaque pièce validée doit produire, et sur quel compte — règle unique, partagée avec la
  // Checklist (voir lib/ecritures.ts). La facture d'un bien immobilisé s'écrit sur le compte de sa
  // NATURE, pas sur sa catégorie : c'est un actif qui s'amortit, pas une charge courante, et la passer
  // en charge compterait la dépense deux fois. Un bien sans nature ne s'écrit pas.
  const aComptabiliser = piecesAComptabiliser(piecesValidees, categories, acquisitions)
  // Les paiements de chaque pièce, parts des virements groupés comprises : ils datent sa charge et portent
  // ses contreparties banque (lib/rattachement.ts).
  const paiements = paiementsDesPieces(lignesBancaires, reglements)
  // Les pièces sans écriture, et ce que la génération écrirait d'elles. Rien ne s'écrit au plus tard à la frontière
  // de validation (lib/validationExercice.ts) : la base le refuserait, et tout le lot avec, l'insertion étant d'un
  // seul tenant. Une pièce dont une part tombe dans un exercice validé est NOMMÉE plus bas, plutôt que de
  // disparaître du compte sans un mot.
  const generation = ecrituresAGenerer(dossierId, aComptabiliser, ecritures, assujettiTva, paiements, modele, frontiere)
  const enAttente = generation.pieces
  const nbValidees = ecritures.filter((e) => e.statut === 'validee').length
  const nbProposees = ecritures.length - nbValidees
  // UNE OUVERTURE LUE EN PARTIE NE DIT PAS QUELS BIENS SONT REPRIS : l'acquisition d'un bien acquis avant
  // elle s'écrirait une seconde fois, la balance reprise la portant déjà. La génération attend donc une
  // lecture complète dès qu'un bien est en attente — les autres pièces ne dépendent pas des à-nouveaux.
  const biensSansOuverture = aNouveauxIncomplets !== null && enAttente.some((p) => pieceIdsImmobilisees.has(p.id))

  // UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE. `enAttente`, ce sont les pièces à
  // comptabiliser MOINS celles dont on a LU l'écriture : sur un brouillon lu à moitié, il porte des
  // pièces déjà comptabilisées, et générer doublerait leur charge — dans le FEC comme dans la
  // balance, et seul « Régénérer », pièce par pièce, saurait la défaire. Des immobilisations lues à
  // moitié feraient pire : une charge pour un bien qui s'amortit déjà. `brouillonIncomplet` couvre
  // les cinq lectures dont dépend la génération, les mêmes que celles des deux exports.
  async function genererEcritures() {
    if (enAttente.length === 0 || brouillonIncomplet !== null || biensSansOuverture || generationEnCours.current || changementModeleEnCours.current) return
    generationEnCours.current = true
    setGenerating(true)
    setError(null)
    try {
      // Selon le modèle du dossier : en trésorerie, la charge datée au paiement quand le rapprochement le
      // connaît, comme la 2035 compte la pièce, et une contrepartie banque par paiement ; en engagement,
      // la facture à sa date et un règlement par paiement (lib/engagement.ts). Dans les deux, une pièce
      // déjà rapprochée — ou réglée en partie par un virement groupé — reçoit sa banque tout de suite. Et
      // seulement ce qui tombe après la frontière de validation (`ecrituresAGenerer`).
      const { error: insertError } = await supabase.from('ecritures_brouillon').insert(generation.lignes)
      if (insertError) throw insertError
      // Relu AVANT de relâcher le verrou : relâché plus tôt, `enAttente` porterait encore les pièces
      // qu'on vient de comptabiliser le temps que la relecture revienne, et un clic à ce moment-là
      // les générerait une seconde fois.
      await load()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      generationEnCours.current = false
      setGenerating(false)
    }
  }

  // Le filtre par année ne porte que sur l'affichage des écritures déjà générées — la génération
  // (bouton ci-dessous) reste globale, sur toutes les pièces en attente quelle que soit leur année.
  const ecrituresFiltrees = anneeFilter === 'toutes' ? ecritures : ecritures.filter((e) => anneeDe(e.date) === anneeFilter)
  // Les à-nouveaux de l'exercice exporté : ils ouvrent son FEC et sa piste d'audit, et aucun autre.
  const aNouveauxExercice = anneeFilter === 'toutes' ? aNouveaux : aNouveaux.filter((a) => anneeDe(a.date) === anneeFilter)

  // La recherche ne filtre QUE les lignes affichées, jamais les données de calcul ni l'export : les
  // totaux de TVA ci-dessous et le FEC exporté plus bas portent sur `ecrituresFiltrees`. Les brancher
  // sur la recherche ferait varier la TVA déductible au fil de la frappe, et surtout exporterait un
  // FEC amputé des lignes qui ne correspondent pas au texte tapé — un fichier fiscal incomplet sans
  // que rien ne le signale.
  const ecrituresAffichees = ecrituresFiltrees.filter((e) =>
    correspondALaRecherche([e.date, formatDate(e.date), e.compte, e.libelle, e.sens, e.montant], recherche),
  )

  // Sur les biens et services (445660) ET sur les immobilisations (445620) : la TVA de l'acquisition d'un bien
  // se déduit comme l'autre — en ligne 19 de la CA3 plutôt qu'en ligne 20.
  const tvaDeductible = soldeCompte(ecrituresFiltrees, COMPTE_TVA_DEDUCTIBLE, 'debit') + soldeCompte(ecrituresFiltrees, COMPTE_TVA_IMMOBILISATIONS, 'debit')
  const tvaCollectee = soldeCompte(ecrituresFiltrees, COMPTE_TVA_COLLECTEE, 'credit')

  // Trois contrôles d'intégrité du brouillon (voir lib/ecritures.ts) — volontairement indépendants du
  // filtre Année ci-dessus : ce sont des défauts sur l'état actuel du brouillon, pas des totaux à
  // consulter par exercice. Une écriture sans contrepartie banque ou déséquilibrée d'un ancien exercice
  // ne doit pas disparaître de la vue juste parce que l'onglet Année est positionné ailleurs.
  const { piecesSansContrepartie, groupesDesequilibres, piecesDesynchronisees } = analyserEcritures(ecritures, aComptabiliser, assujettiTva, paiements, modele, frontiere)
  // En engagement, une facture qu'un lettrage fait à la main solde avec son avoir n'attend plus de règlement : la compter
  // « sans règlement rapproché » enverrait chercher un paiement qui n'existera jamais (lib/lettrage.ts).
  const lettreesALaMain = piecesLettreesALaMain(etatsDesLettragesManuels(ecritures, piecesValidees, lettragesManuels, modele.mode))
  const nbSansContrepartie = piecesSansContrepartie.filter((id) => !lettreesALaMain.has(id)).length
  // Le quatrième contrôle, celui qui part de l'ÉCRITURE : ce que le brouillon continue de compter
  // alors que la pièce ne le justifie plus (voir lib/ecritures.ts).
  const sansObjet = ecrituresSansObjet(ecritures, piecesValidees, categories, acquisitions, frontiere)

  // Piste d'audit fiable — voir lib/pisteAudit.ts. Volontairement calculé sur TOUTES les écritures,
  // hors filtre Année comme les trois contrôles ci-dessus : une écriture qui a perdu son justificatif
  // ne doit pas disparaître de la vue parce que l'onglet Année est positionné ailleurs.
  // L'écriture d'un mouvement AFFECTÉ ou d'un VIREMENT PERSONNEL n'a pas de pièce, par construction :
  // son justificatif est le relevé, et elle va au FEC (journal de banque). Elle n'est donc ni une
  // rupture ni un absent du FEC.
  const idsJustifies = idsMouvementsJustifiesParLeReleve(lignesBancaires)
  const ruptures = rupturesPisteAudit(ecritures, idsJustifies)
  // L'EXERCICE AFFICHÉ EST-IL VALIDÉ ? Son FEC se relit alors depuis ce que la validation a figé (lib/fec.ts,
  // `numerotationValidee`) : journal, numéro, pièce et libellés de chaque écriture, tels que la base les a gardés.
  // Rien n'est relu des pièces ni des catégories d'aujourd'hui — une catégorie renommée ne change plus le fichier,
  // et deux exports rendent le même, au lettrage près : il suit les règlements écrits depuis (lib/lettrage.ts).
  const exerciceValideAffiche = typeof anneeFilter === 'number' ? exercicesValides.find((e) => e.annee === anneeFilter) ?? null : null
  const fecValide = exerciceValideAffiche ? numerotationValidee(ecrituresFiltrees, aNouveauxExercice, exerciceValideAffiche.valide_le) : null
  // LE LETTRAGE des comptes de tiers (lib/lettrage.ts), calculé sur TOUT le brouillon et non sur l'exercice affiché :
  // une facture de décembre réglée en janvier porte le même code dans les deux FEC. Il ne se fige pas avec l'exercice —
  // il dit l'état des comptes de tiers au jour de l'export, le FEC validé compris. Les lettrages faits à la main y
  // prennent leur place quand ils tiennent encore, revérifiés sur les pièces que le FEC lit : celles qui sont validées.
  const lettrage = lettrages(ecritures, piecesValidees, lettragesManuels, modele.mode)
  // En engagement seulement : en trésorerie, rien ne se lettre, et une lecture ratée de ces lignes ne change rien.
  const lettragesManquants = modele.mode === 'engagement' ? lettragesIncomplets : null
  // Celui-ci, en revanche, porte sur l'exercice EXPORTÉ : c'est ce fichier-là qui partira amputé. Pour un exercice
  // validé, ce que sa numérotation figée ne porte pas — qui ne peut pas exister, la base refusant la validation tant
  // qu'une écriture de l'exercice reste proposée, et qui se voit donc plutôt que de se cacher.
  const horsFec = fecValide
    ? {
      nb: fecValide.horsFec.length,
      debit: fecValide.horsFec.filter((e) => e.sens === 'debit').reduce((somme, e) => somme + e.montant, 0),
      credit: fecValide.horsFec.filter((e) => e.sens === 'credit').reduce((somme, e) => somme + e.montant, 0),
    }
    : absenceFec(ecrituresFiltrees, idsJustifies)
  // Les mouvements affectés dont l'écriture n'est plus celle que leur catégorie produirait — le compte
  // de la catégorie a changé depuis, ou la recette d'un dossier qui a cessé d'être assujetti porte encore
  // sa TVA (voir lib/affectationBanque.ts).
  const affectesPerimes = mouvementsAffectesDesynchronises(ecritures, mouvementsAffectes(lignesBancaires, categories, assujettiTva), frontiere)
  // Les mouvements ventilés dont l'écriture n'est plus celle que leurs parts produiraient — le compte d'une
  // catégorie a changé depuis (voir lib/ventilationBanque.ts). Sur des parts lues EN ENTIER seulement : une
  // part non lue ferait passer une ventilation pour incohérente, donc la tairait ici.
  const ventilesPerimes = ventilationsIncompletes ? [] : mouvementsVentilesDesynchronises(ecritures, lignesBancaires, ventilations, categories, modele, assujettiTva, frontiere)
  const pieceById = (id: string) => piecesValidees.find((p) => p.id === id) ?? null

  // Export de la piste d'audit de l'exercice (voir lib/pisteAudit.ts) : depuis chaque écriture, le
  // justificatif et l'opération bancaire réelle, et dans l'autre sens les justificatifs validés que
  // rien ne comptabilise. C'est ce qu'un vérificateur demande à produire, et c'est un fichier — pas
  // un écran : il part par e-mail, il se relit hors de l'application.
  //
  // Il relit les mouvements bancaires en entier à ce moment-là, sur ce clic : `lignesBancaires`
  // ci-dessus est volontairement restreint aux lignes rapprochées (c'est ce dont la génération et les
  // mouvements affectés ont besoin), et une piste d'audit bâtie sur un jeu restreint annoncerait des
  // mouvements manquants qui existent.
  async function exporterPisteAudit() {
    if (typeof anneeFilter !== 'number') return
    setExportPiste(true)
    setError(null)
    try {
      // Une lecture dont l'échec ressemble à un résultat vide se vérifie comme une écriture : sans
      // ce contrôle, un refus RLS produirait un export où CHAQUE contrepartie annonce un mouvement
      // absent — un fichier faux, et qui a l'air complet.
      const mouvements = await lireTout<LigneBancaire>((debut, fin) =>
        supabase.from('lignes_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin),
      )
      if (!mouvements.complete) {
        throw new Error(
          `Les mouvements bancaires n'ont pas pu être lus en entier (${mouvements.motif}). ` +
          "L'export est annulé : une piste d'audit bâtie sur une lecture partielle annoncerait " +
          'manquants des mouvements qui existent.',
        )
      }
      // Les lignes du cadre 7, lues sur ce clic comme les mouvements : elles nomment le véhicule et le
      // kilométrage de chaque forfait kilométrique (lib/forfaitKilometrique.ts), et rien d'autre sur cet
      // écran n'en a besoin. Lues en partie, un forfait se dirait « véhicule hors du jeu chargé » — l'export
      // se refuse plutôt.
      const vehicules = await lireTout<VehiculeDossier>((debut, fin) =>
        supabase.from('vehicules').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('annee').order('id').range(debut, fin),
      )
      if (!vehicules.complete) {
        throw new Error(
          `Les véhicules du cadre 7 n'ont pas pu être lus en entier (${vehicules.motif}). ` +
          "L'export est annulé : un forfait kilométrique y perdrait le véhicule et le kilométrage qui le justifient.",
        )
      }
      // L'exercice d'une pièce est celui de son paiement, sa date de facture à défaut — celui où ses
      // écritures sont datées (lib/rattachement.ts) ; sans quoi une facture de décembre réglée en
      // janvier figurerait dans la piste de décembre comme un justificatif que rien ne comptabilise.
      // En engagement, celui de sa facture, où son écriture de facture est datée.
      // Une pièce que rien ne date n'appartient à aucun exercice : elle est jointe à chacun, et la
      // colonne « Ce qui manque » le dit (voir lib/pisteAudit.ts) plutôt que de la taire.
      const piecesExercice = piecesValidees.filter((p) => {
        const parts = rattachements(p, paiements.get(p.id) ?? [], modele.mode)
        return parts.some((r) => r.date === null) || anneesDesRattachements(parts).includes(anneeFilter)
      })
      // Les factures d'acquisition se cherchent parmi TOUTES les pièces validées : un bien acheté un autre
      // exercice s'amortit dans celui-ci, et sa facture est la preuve de sa dotation.
      const contenu = genererPisteAuditCsv(pisteAudit(
        ecrituresFiltrees, piecesExercice, mouvements.lignes, aNouveauxExercice,
        { immobilisations, factures: piecesValidees, vehicules: vehicules.lignes },
      ))
      telechargerTexte(nomFichierPisteAudit(dossierNom, anneeFilter), contenu)
    } catch (err) {
      setError(messageErreur(err, "L'export de la piste d'audit a échoué."))
    } finally {
      setExportPiste(false)
    }
  }

  // Reprend les écritures d'une pièce d'après ses montants actuels — jamais automatique, seulement sur
  // ce clic explicite. TOUT, dans les deux modèles : la charge ou la facture, et les lignes de banque, qui
  // se déduisent des paiements — une contrepartie par paiement en trésorerie, un règlement par paiement en
  // engagement (lib/ecritures.ts). Les reprendre ne perd rien, et c'est ce qui complète une pièce payée en
  // plusieurs fois, ou réglée en partie par un virement groupé, dont le rapprochement n'avait écrit qu'une
  // contrepartie ; en engagement, ce qui répare un règlement resté sur l'ancien compte de tiers.
  //
  // SUSPENDUE SUR UNE LECTURE PARTIELLE, comme la génération : les paiements datent la charge en
  // trésorerie et décident des lignes de banque dans les deux modèles — lus à moitié, régénérer daterait
  // mal, ou SUPPRIMERAIT des contreparties qui existent.
  //
  // Sur la cible de la génération (`piecesAComptabiliser`) : le compte de la catégorie, ou celui du bien
  // pour la facture d'une immobilisation — c'est ce qui fait passer sur le compte du bien l'écriture d'une
  // pièce immobilisée après coup.
  async function regenererEcriture(piece: Piece) {
    const cible = aComptabiliser.find((a) => a.piece.id === piece.id)
    if (!cible || brouillonIncomplet !== null || regenerationsEnCours.current.has(piece.id)) return
    // Le bien d'une ouverture lue en partie : on ne sait pas s'il est repris (voir `biensSansOuverture`).
    if (cible.immobilisation && aNouveauxIncomplets !== null) return
    regenerationsEnCours.current.add(piece.id)
    setRegenerating(piece.id)
    setError(null)
    try {
      // La part d'un exercice validé ne se retire ni ne se réécrit — la base le refuse (lib/validationExercice.ts) :
      // seule la part datée après la frontière se reprend, et c'est exactement ce que le contrôle compare.
      const { error: deleteError } = frontiere === null
        ? await supabase.from('ecritures_brouillon').delete().eq('piece_id', piece.id)
        : await supabase.from('ecritures_brouillon').delete().eq('piece_id', piece.id).gt('date', frontiere)
      if (deleteError) throw deleteError
      const lignes = lignesOuvertes(lignesPourPiece(
        dossierId, piece, { compte: cible.compte, immobilisation: cible.immobilisation }, assujettiTva, paiements.get(piece.id) ?? [], modele,
      ), frontiere)
      // Une pièce dont tout tombe désormais dans un exercice validé n'a plus rien à écrire : la génération la nomme.
      if (lignes.length > 0) {
        const { error: insertError } = await supabase.from('ecritures_brouillon').insert(lignes)
        if (insertError) throw insertError
      }
      load()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      regenerationsEnCours.current.delete(piece.id)
      setRegenerating(null)
    }
  }

  // Réécrit l'écriture d'un mouvement affecté sur le compte ACTUEL de sa catégorie, par la même fonction
  // que l'affectation (`affecter_mouvement_bancaire`), qui remplace l'écriture précédente dans la même
  // transaction. Sur ce clic seulement, comme « Régénérer ». Le taux est celui qui s'applique AUJOURD'HUI
  // (`MouvementAffecte.taux`) : une recette d'un dossier qui a cessé d'être assujetti se réécrit au TTC, et
  // la base refuserait le taux gardé. Celle d'un dossier devenu assujetti qui n'en a pas est refusée : son
  // taux se choisit dans la fiche du mouvement, rien ne le devine.
  async function reaffecter(m: MouvementAffecte) {
    if (reaffectationsEnCours.current.has(m.ligne.id)) return
    const refus = refusAffectation(m.ligne, m.categorie, assujettiTva, m.taux)
    if (refus || !m.categorie.compte_comptable) {
      setError(refus ?? `La catégorie « ${m.categorie.libelle} » n’a pas de compte.`)
      return
    }
    reaffectationsEnCours.current.add(m.ligne.id)
    setReaffectation(m.ligne.id)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('affecter_mouvement_bancaire', {
        p_ligne_bancaire_id: m.ligne.id,
        p_categorie_id: m.categorie.id,
        p_ecritures: ecritureDuMouvement(m.ligne, m.categorie.compte_comptable, m.taux),
        p_taux_tva: m.taux,
      })
      if (rpcError) throw rpcError
      // Relu AVANT de relâcher le verrou : le panneau porte encore le mouvement tant que la relecture
      // n'est pas revenue.
      await load()
    } catch (err) {
      setError(messageErreur(err, 'Le mouvement n’a pas pu être réaffecté.'))
    } finally {
      reaffectationsEnCours.current.delete(m.ligne.id)
      setReaffectation(null)
    }
  }

  // Réécrit l'écriture d'un mouvement ventilé depuis ses parts, sur les comptes ACTUELS de leurs catégories,
  // par la même fonction que la ventilation (`ventiler_mouvement_bancaire`), qui remplace les parts et
  // l'écriture dans la même transaction — les parts renvoyées sont celles qu'on a lues, avec le seul taux qui
  // s'applique aujourd'hui (`partsAReecrire`). Sur ce clic seulement, comme « Réaffecter », et jamais sur des
  // parts lues en partie : il les remplacerait.
  async function reecrireVentilation(ligne: LigneBancaire) {
    if (ventilationsIncompletes || reaffectationsEnCours.current.has(ligne.id)) return
    const parts = partsAReecrire(ventilations.filter((v) => v.ligne_bancaire_id === ligne.id), categories, assujettiTva)
    const refus = refusVentilation(ligne, parts, categories, assujettiTva)
    const ecriture = refus ? null : ecritureDeLaVentilation(ligne, parts, categories, modele, assujettiTva)
    if (!ecriture) {
      setError(refus ?? 'Une part n’a plus de compte de charge ou de produit : modifie la ventilation depuis la fiche du mouvement, dans Banque.')
      return
    }
    reaffectationsEnCours.current.add(ligne.id)
    setReaffectation(ligne.id)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('ventiler_mouvement_bancaire', {
        p_ligne_bancaire_id: ligne.id,
        p_parts: parts.map((p) => ({ categorie_id: p.categorie_id, part_personnelle: p.part_personnelle, montant: p.montant, taux_tva: p.taux_tva })),
        p_ecritures: ecriture,
      })
      if (rpcError) throw rpcError
      await load()
    } catch (err) {
      setError(messageErreur(err, 'L’écriture de la ventilation n’a pas pu être réécrite.'))
    } finally {
      reaffectationsEnCours.current.delete(ligne.id)
      setReaffectation(null)
    }
  }

  // Le modèle ne se change que tant que le brouillon est vide — et lu en entier : un brouillon lu à
  // moitié peut porter des écritures qu'on ne voit pas, et la base refuserait alors le changement.
  const modeleModifiable = !loading && brouillonIncomplet === null && ecritures.length === 0
  const raisonVerrouModele = loading
    ? 'Lecture du brouillon…'
    : brouillonIncomplet !== null
      ? 'Il ne se change pas sur une lecture partielle du brouillon.'
      : `Il ne se change plus : le brouillon porte ${ecritures.length} écriture${ecritures.length > 1 ? 's' : ''}, qui resteraient dans l’ancien modèle.`

  async function changerModele(modification: { mode_comptable?: ModeComptable; compte_notes_de_frais?: CompteNotesDeFrais }) {
    if (!modeleModifiable || generationEnCours.current || changementModeleEnCours.current) return
    changementModeleEnCours.current = true
    setChangementModele(true)
    setError(null)
    try {
      const { error: updateError } = await supabase.from('dossiers').update(modification).eq('id', dossierId)
      if (updateError) throw updateError
      onModeleUpdated(modification)
    } catch (err) {
      setError(messageErreur(err, 'Le modèle comptable n’a pas pu être enregistré.'))
    } finally {
      changementModeleEnCours.current = false
      setChangementModele(false)
    }
  }
  // Le compte du dirigeant, dit dans les deux modèles : en trésorerie aussi, ce qu'il a payé de sa poche et ses
  // virements personnels passent par un compte qui n'est ni une charge ni une recette (lib/virementPersonnel.ts).
  const compteDirigeant = COMPTES_NOTES_DE_FRAIS.find((c) => c.compte === compteDuDirigeant(modele))!

  // Retire du brouillon TOUTES les lignes d'une pièce, contrepartie banque comprise — et c'est la
  // seule forme correcte. N'ôter que la charge laisserait la ligne banque SEULE dans son groupe,
  // c'est-à-dire un groupe qui porte bien une contrepartie et dont le solde n'est pas nul : très
  // exactement ce que `groupesDesequilibres` signale, et que plus aucun geste ne pourrait éteindre.
  // On échangerait une alerte vraie contre une alerte fausse et définitive.
  //
  // Réservé aux deux motifs d'un BIEN, délibérément. Pour les trois autres, l'écriture DOIT exister une
  // fois la pièce corrigée en amont : y offrir « Retirer » permettrait de faire disparaître une charge
  // réelle d'un clic, sans trace.
  //
  // Depuis que l'acquisition s'écrit (lib/ecritures.ts, `piecesAComptabiliser`), ces deux motifs désignent :
  // - la facture d'un bien SANS NATURE : son compte d'immobilisation n'est pas connu, donc ni la génération
  //   ni « Régénérer » ne savent où l'écrire. Retirer l'écriture ôte la charge qu'elle porte encore ; une
  //   fois la nature choisie, la pièce revient parmi celles à comptabiliser et la génération écrit son
  //   acquisition sur le compte du bien. Choisir la nature d'abord, puis régénérer, mène au même endroit en
  //   un geste de moins ;
  // - la facture d'un bien REPRIS, acquis avant l'ouverture du dossier : la balance reprise porte déjà sa
  //   valeur, en classe 2, et ses paiements d'alors sont dans la banque d'ouverture. Rien ne doit s'écrire,
  //   et retirer est le SEUL geste juste.
  //
  // TOUTES, sauf celles d'un exercice VALIDÉ (lib/validationExercice.ts) : la base refuse de les retirer, et la part
  // qu'elles forment s'équilibre seule — en trésorerie chaque paiement y porte sa contrepartie, en engagement la
  // facture porte sa dette. Seule la part d'après la frontière part.
  //
  // Pas de verrou `useRef` ici, contrairement aux gestes qui DUPLIQUENT : une suppression est
  // idempotente, deux clics retirent les mêmes lignes. `retrait` n'est qu'un état d'affichage.
  async function retirerEcriture({ piece, motif }: EcritureSansObjet) {
    // Une part datée d'un exercice validé ne se retire plus (lib/validationExercice.ts) : la confirmation le dit, et
    // seule la part ouverte part.
    const partFigee = ecritures.some((e) => e.piece_id === piece.id && estFigee(e.date, frontiere))
    if (!window.confirm(
      `Retirer du brouillon l'écriture de « ${piece.tiers ?? piece.nom_fichier} » ? `
      + (modele.mode === 'engagement'
        ? 'Sa ligne de charge, sa TVA, sa dette envers le fournisseur et ses règlements partent ensemble. '
        : 'Sa ligne de charge, sa TVA et sa contrepartie banque partent ensemble. ')
      + (partFigee && frontiere ? `Sa part datée d’un exercice validé, au plus tard le ${formatDate(frontiere)}, reste : elle ne se retire plus. ` : '')
      + "La pièce, son rapprochement bancaire et l'immobilisation ne bougent pas : la dépense reste "
      + (motif === 'bien_repris'
        ? "comptée par l'amortissement, et la balance reprise porte déjà son acquisition."
        : "comptée par l'amortissement, et son acquisition s'écrira sur le compte du bien une fois sa nature choisie."),
    )) return
    setRetrait(piece.id)
    setError(null)
    try {
      const { error: deleteError } = frontiere === null
        ? await supabase.from('ecritures_brouillon').delete().eq('piece_id', piece.id)
        : await supabase.from('ecritures_brouillon').delete().eq('piece_id', piece.id).gt('date', frontiere)
      if (deleteError) throw deleteError
      load()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      setRetrait(null)
    }
  }

  const piecesSansTva = calculerPiecesSansTva(piecesValidees, assujettiTva)
  const piecesSansCategorie = piecesValideesSansCategorie(piecesValidees, pieceIdsImmobilisees)
  // Cet onglet ne charge que les pièces VALIDÉES : ce sont donc les TVA fausses déjà figées dans une
  // écriture et parties en déduction. Les autres se voient en amont, dans Justificatifs, là où on
  // peut encore les corriger avant de valider.
  const tvaImpossible = piecesTvaImpossible(piecesValidees)


  return (
    <>
      <BrouillonBanner />

      {/* Le modèle comptable : un choix offert tant que le brouillon est vide — c'est là qu'il se prend,
          avant la première génération —, une ligne qui le rappelle ensuite. Des BOUTONS et non des
          boutons radio : sur un groupe radio qui a le focus, les flèches du clavier changent la valeur,
          donc l'enregistreraient — le piège déjà payé sur la liste déroulante du rapprochement. */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Modèle comptable</h3>
        {modeleModifiable ? (
          <>
            <p className="muted" style={{ marginTop: -8 }}>
              Il décide des comptes de toutes les écritures du dossier. Il ne se change que tant que le
              brouillon est vide : c'est donc avant la première génération qu'il se choisit.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {(['tresorerie', 'engagement'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`btn btn-sm ${modele.mode === mode ? 'btn-primary' : 'btn-outline'}`}
                  aria-pressed={modele.mode === mode}
                  disabled={changementModele || generating}
                  onClick={() => { if (modele.mode !== mode) changerModele({ mode_comptable: mode }) }}
                >
                  {LIBELLES_MODE[mode]}
                </button>
              ))}
            </div>
            <p className="muted" style={{ margin: 0 }}>{EXPLICATIONS_MODE[modele.mode]}</p>
            {modele.mode === 'engagement' && (
              <div style={{ marginTop: 14 }}>
                <strong>Note de frais payée personnellement par le dirigeant</strong>
                <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {COMPTES_NOTES_DE_FRAIS.map((c) => (
                    <li key={c.compte}>
                      <button
                        type="button"
                        className={`btn btn-sm ${modele.compteNotesDeFrais === c.compte ? 'btn-primary' : 'btn-outline'}`}
                        aria-pressed={modele.compteNotesDeFrais === c.compte}
                        disabled={changementModele || generating}
                        onClick={() => { if (modele.compteNotesDeFrais !== c.compte) changerModele({ compte_notes_de_frais: c.compte }) }}
                      >
                        {c.libelle}
                      </button>
                      <p className="muted" style={{ margin: '4px 0 0' }}>{c.explication}</p>
                    </li>
                  ))}
                </ul>
                {/* Le même compte, parce que c'est la même personne : deux comptes pour le dirigeant
                    partageraient ce qu'on lui doit en deux moitiés (lib/virementPersonnel.ts). */}
                <p className="muted" style={{ margin: '10px 0 0' }}>
                  Ce compte reçoit aussi les virements entre le compte de l’entreprise et le compte personnel
                  du dirigeant (« Virement personnel », onglet Banque).
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            <strong>{LIBELLES_MODE[modele.mode]}</strong>
            {` — notes de frais et virements personnels du dirigeant en ${compteDirigeant.libelle.replace(/ \(.*\)$/, '')}`}.
            {' '}{raisonVerrouModele}
          </p>
        )}
      </div>

      {/* EN PREMIER, avant même « sans catégorie » : celles-là ne produisent RIEN, celle-ci produit
          quelque chose de FAUX. Un total manquant finit par se remarquer ; un total juste en
          apparence et compté deux fois, non. */}
      {sansObjet.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Écritures que la pièce ne justifie plus <span className="badge badge-danger">bloquant</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces écritures ont été générées, puis la pièce a changé de nature — rien ne les a retirées.
            Elles comptent encore dans le FEC et dans la Balance des comptes, qui se calculent sur le
            brouillon,{modele.mode === 'engagement'
              ? ' alors que la pièce ne les justifie plus.'
              : ' alors que la 2035 se calcule sur les pièces et les écarte : les deux livrables ne disent plus la même chose.'}
            {' '}Aucun autre contrôle ne peut les voir — les trois autres partent de la pièce, celui-ci
            part de l'écriture.
          </p>
          <table>
            <thead><tr><th>Pièce</th><th>Compté au brouillon</th><th>Ce qui a changé</th><th>Ce qu'il faut faire</th></tr></thead>
            <tbody>
              {sansObjet.map((o) => (
                <tr key={o.piece.id}>
                  <td>{o.piece.tiers ?? o.piece.nom_fichier}</td>
                  <td>{formatMoney(o.montant)} <span className="muted">({o.nbLignes} ligne{o.nbLignes > 1 ? 's' : ''})</span></td>
                  <td>{LIBELLE_MOTIF_SANS_OBJET[o.motif]}</td>
                  <td className="muted">
                    {ACTION_MOTIF_SANS_OBJET[o.motif]}
                    {/* Le bouton n'existe QUE pour la facture d'un bien. Les trois autres motifs se
                        réparent en amont puis se régénèrent : l'écriture doit y revenir, pas
                        disparaître. */}
                    {(o.motif === 'bien_sans_nature' || o.motif === 'bien_repris') && (
                      <div style={{ marginTop: 8 }}>
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={retrait === o.piece.id}
                          onClick={() => retirerEcriture(o)}
                        >
                          {retrait === o.piece.id ? 'Retrait…' : "Retirer l'écriture"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Avant « Pièces sans TVA » : une pièce sans catégorie ne produit RIEN, là où une TVA manquante
          ne fausse qu'une ligne. Le contrôle le plus bloquant se lit en premier. */}
      {piecesSansCategorie.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Pièces validées sans catégorie <span className="badge badge-danger">à traiter</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            {piecesSansCategorie.length === 1 ? 'Cette pièce est validée' : `Ces ${piecesSansCategorie.length} pièces sont validées`} mais {piecesSansCategorie.length === 1 ? 'n\'a' : 'n\'ont'} aucune catégorie : {piecesSansCategorie.length === 1 ? 'elle ne génère' : 'elles ne génèrent'} aucune écriture et {piecesSansCategorie.length === 1 ? 'n\'entre' : 'n\'entrent'} dans aucun total de Clôture ni dans la 2035. Le travail de vérification est fait, il ne compte nulle part — la catégorie se donne depuis l'onglet Justificatifs.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {piecesSansCategorie.map((p) => (
              <li key={p.id}>{p.tiers ?? p.nom_fichier} — {formatMoney(p.montant_ttc)}{p.date_piece ? ` (${p.date_piece})` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Avant « Pièces sans TVA » : une TVA absente se voit (la case est vide), une TVA fausse a
          l'air remplie — et c'est celle-là qui part en déduction. */}
      {tvaImpossible.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            TVA impossible <span className="badge badge-danger">à traiter</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Sur {tvaImpossible.length === 1 ? 'cette pièce validée' : `ces ${tvaImpossible.length} pièces validées`}, le calcul démontre que la TVA lue
            ne peut pas être celle du document — elle est pourtant déjà partie en TVA déductible et
            dans la charge. Les montants se corrigent depuis l'onglet Justificatifs, puis l'écriture
            est à régénérer.
          </p>
          <table>
            <thead><tr><th>Pièce</th><th>HT</th><th>TVA lue</th><th>TTC</th><th>Ce qui cloche</th></tr></thead>
            <tbody>
              {tvaImpossible.map(({ piece: p, motif }) => (
                <tr key={p.id}>
                  <td>{p.tiers ?? p.nom_fichier}</td>
                  <td>{formatMoney(p.montant_ht)}</td>
                  <td>{formatMoney(p.montant_tva)}</td>
                  <td>{formatMoney(p.montant_ttc)}</td>
                  <td className="muted">{LIBELLE_MOTIF_TVA[motif]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {piecesSansTva.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          {/* Sévérité signalée par un badge, pas par une bordure de couleur sur toute la carte (voir
              discipline visuelle — une couleur d'accent utilisée avec parcimonie, pas dispersée). */}
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Pièces sans TVA renseignée <span className="badge badge-warning">à vérifier</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ce dossier est marqué assujetti à la TVA, mais {piecesSansTva.length} pièce{piecesSansTva.length > 1 ? 's' : ''} validée{piecesSansTva.length > 1 ? 's' : ''} n'a{piecesSansTva.length > 1 ? 'ont' : ''} pas de montant de TVA — vérifie si c'est normal (achat auprès d'un non-assujetti…) ou un oubli de saisie.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {piecesSansTva.map((p) => (
              <li key={p.id}>{p.tiers ?? p.nom_fichier} — {formatMoney(p.montant_ttc)}</li>
            ))}
          </ul>
        </div>
      )}

      {piecesDesynchronisees.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Écritures à régénérer <span className="badge badge-danger">à traiter</span>
          </h3>
          {modele.mode === 'engagement' ? (
            <p className="muted" style={{ marginTop: -8 }}>
              Ces pièces ont changé depuis que leurs écritures ont été générées : montant TTC,
              ventilation de la TVA, catégorie (donc compte), date, type (donc compte de tiers — un achat
              devenu note de frais quitte le 401), ou paiements — un paiement rapproché sans règlement
              laisse au 401 une dette déjà payée, et la part d’un virement groupé réglé de nouveau change
              le montant du sien. « Régénérer » reprend la facture et ses règlements d’après la pièce et
              ses paiements actuels.
            </p>
          ) : (
            <p className="muted" style={{ marginTop: -8 }}>
              Ces pièces ont changé depuis que leur écriture a été générée : montant TTC, ventilation de
              la TVA, catégorie (donc compte), date, ou paiements. Plusieurs ne déplacent AUCUN total —
              une catégorie change le compte qui part en FEC, une date change l'EXERCICE dans lequel
              l'écriture tombe alors que la 2035 lit celle du paiement, et une TVA corrigée à TTC constant
              change la répartition entre charge et TVA déductible à somme juste. Et chaque paiement doit
              avoir sa contrepartie banque : une pièce payée en deux fois, ou réglée en partie par un
              virement groupé, n’en avait qu’une. « Régénérer » reprend la charge et ses contreparties
              d’après la pièce et ses paiements actuels.
            </p>
          )}
          <table>
            <thead><tr><th>Pièce</th><th>Montant actuel</th><th>Date actuelle</th><th></th></tr></thead>
            <tbody>
              {piecesDesynchronisees.map((p) => (
                <tr key={p.id}>
                  <td>{p.tiers ?? p.nom_fichier}</td>
                  <td>{formatMoney(p.montant_ttc)}</td>
                  <td>{p.date_piece ? formatDate(p.date_piece) : <span className="muted">sans date</span>}</td>
                  <td>
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={regenerating === p.id || brouillonIncomplet !== null || (aNouveauxIncomplets !== null && pieceIdsImmobilisees.has(p.id))}
                      title={brouillonIncomplet
                        ? `Lecture incomplète (${brouillonIncomplet}) — régénérer maintenant pourrait mal dater l’écriture, ou retirer des règlements.`
                        : aNouveauxIncomplets !== null && pieceIdsImmobilisees.has(p.id)
                        ? `À-nouveaux lus incomplètement (${aNouveauxIncomplets}) — on ne sait pas si la balance reprise porte déjà ce bien.`
                        : undefined}
                      onClick={() => regenererEcriture(p)}
                    >
                      {regenerating === p.id ? 'Régénération…' : 'Régénérer'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Une pièce que la frontière coupe : sa part validée ne se réécrit plus, et le contrôle ne compare que
              l'autre (lib/ecritures.ts) — le dire évite de chercher pourquoi l'ancien compte reste dans l'exercice. */}
          {frontiere && piecesDesynchronisees.some((p) => ecritures.some((e) => e.piece_id === p.id && estFigee(e.date, frontiere))) && (
            <p className="muted" style={{ marginBottom: 0 }}>
              Une partie de ces écritures est datée d’un exercice validé, au plus tard le {formatDate(frontiere)} : elle
              ne se réécrit plus. « Régénérer » ne reprend que la part datée après.
            </p>
          )}
        </div>
      )}

      {affectesPerimes.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Mouvements affectés à réaffecter <span className="badge badge-danger">à traiter</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces mouvements du relevé sont affectés à une catégorie dont le compte a changé depuis — ou ce
            sont des recettes d’un dossier qui a cessé d’être assujetti à la TVA : leur écriture porte encore
            l’ancien compte ou la TVA, ou n’existe plus. Aucun total ne bouge, et c’est ce qui rend l’écart
            invisible ailleurs. « Réaffecter » la réécrit sur le compte actuel de la catégorie, au taux qui
            s’applique aujourd’hui ; si la catégorie n’a plus de compte de charge ou de produit, ou si la
            recette attend son taux, c’est depuis la fiche du mouvement, dans Banque.
          </p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Mouvement</th><th>Montant</th><th>Catégorie</th><th></th></tr></thead>
              <tbody>
                {affectesPerimes.map((m) => {
                  // Dit AVANT le clic, comme dans la fiche : une recette qui attend son taux ne se réaffecte
                  // pas d'ici, la base la refuserait.
                  const refus = m.nature ? refusAffectation(m.ligne, m.categorie, assujettiTva, m.taux) : null
                  return (
                    <tr key={m.ligne.id}>
                      <td>{formatDate(m.ligne.date)}</td>
                      <td>{m.ligne.libelle}</td>
                      <td>{formatMoney(m.ligne.montant)}</td>
                      <td>
                        {m.categorie.libelle} <span className="muted">({m.categorie.compte_comptable ?? 'sans compte'})</span>
                        {m.taux != null && <span className="muted"> · TVA {libelleTaux(m.taux)}</span>}
                      </td>
                      <td>
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={reaffectation === m.ligne.id || !m.nature || refus !== null}
                          title={!m.nature
                            ? 'Le compte de cette catégorie n’est pas un compte de charge ou de produit : choisis une autre catégorie dans Banque.'
                            : refus ? `${refus} Depuis la fiche du mouvement, dans Banque.` : undefined}
                          onClick={() => reaffecter(m)}
                        >
                          {reaffectation === m.ligne.id ? 'Réaffectation…' : 'Réaffecter'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <BandeauLecturePartielle
        quoi="Les parts des mouvements ventilés"
        motif={ventilationsIncompletes}
        consequence={
          'Un mouvement ventilé dont l’écriture ne suit plus ses parts peut donc ne pas être signalé, et ' +
          '« Réécrire » est suspendu. Le FEC et la piste d’audit n’en dépendent pas. Recharge la page.'
        }
      />

      {ventilesPerimes.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Mouvements ventilés à réécrire <span className="badge badge-danger">à traiter</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            L’écriture de ces mouvements ventilés n’est plus celle que leurs parts produiraient : le compte d’une
            catégorie a changé depuis, ou le dossier a cessé d’être assujetti à la TVA. Aucun total ne bouge, et
            c’est ce qui rend l’écart invisible ailleurs. « Réécrire » la reprend sur les comptes actuels, au taux
            qui s’applique aujourd’hui ; si une catégorie n’a plus de compte de charge ou de produit, ou si une
            part de recette attend son taux, modifie la ventilation depuis la fiche du mouvement, dans Banque.
          </p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Mouvement</th><th>Montant</th><th></th></tr></thead>
              <tbody>
                {ventilesPerimes.map((l) => {
                  const parts = partsAReecrire(ventilations.filter((v) => v.ligne_bancaire_id === l.id), categories, assujettiTva)
                  const refus = refusVentilation(l, parts, categories, assujettiTva)
                  const reecrivable = !refus && ecritureDeLaVentilation(l, parts, categories, modele, assujettiTva) !== null
                  return (
                    <tr key={l.id}>
                      <td>{formatDate(l.date)}</td>
                      <td>{l.libelle}</td>
                      <td>{formatMoney(l.montant)}</td>
                      <td>
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={reaffectation === l.id || !reecrivable}
                          title={!reecrivable
                            ? refus
                              ? `${refus} Modifie la ventilation depuis la fiche du mouvement, dans Banque.`
                              : 'Une catégorie de cette ventilation n’a plus de compte de charge ou de produit : modifie la ventilation dans Banque.'
                            : undefined}
                          onClick={() => reecrireVentilation(l)}
                        >
                          {reaffectation === l.id ? 'Réécriture…' : 'Réécrire'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ruptures.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Piste d'audit rompue <span className="badge badge-danger">bloquant</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces écritures ne peuvent plus être reliées à ce qui les justifie. C'est la première chose
            qu'un contrôleur demande : montrez-moi la pièce de cette charge. Elles restent comptées
            dans la Balance des comptes mais <strong>sortent du FEC</strong> — le fichier fiscal et la
            balance ne disent donc pas le même résultat. Cause habituelle : la pièce ou le relevé
            bancaire a été supprimé après la génération de l'écriture.
          </p>
          <table>
            <thead><tr><th>Date</th><th>Compte</th><th>Libellé</th><th>Montant</th><th>Ce qui manque</th></tr></thead>
            <tbody>
              {ruptures.map((r, i) => (
                <tr key={`${r.ecriture.id}-${r.motif}-${i}`}>
                  <td>{formatDate(r.ecriture.date)}</td>
                  <td>{r.ecriture.compte}</td>
                  <td>{r.ecriture.libelle}</td>
                  <td>{formatMoney(r.ecriture.sens === 'debit' ? r.ecriture.montant : -r.ecriture.montant)}</td>
                  <td>
                    {r.motif === 'sans_justificatif'
                      ? 'aucun justificatif'
                      : 'aucun mouvement bancaire'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {groupesDesequilibres.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Écritures déséquilibrées <span className="badge badge-danger">à vérifier</span>
          </h3>
          <p className="muted" style={{ marginTop: -8 }}>
            {modele.mode === 'engagement'
              ? 'Une écriture de ces pièces ne s’équilibre pas — le plus souvent une facture dont la TVA ne recoupe pas le TTC. Chaque écriture part sous son propre numéro dans le FEC, et une écriture déséquilibrée fait rejeter le fichier.'
              : 'Le total des débits ne correspond pas à celui des crédits sur ces pièces — un montant réel de mouvement bancaire différent de la pièce (frais, paiement partiel...) l’explique parfois, mais ça mérite toujours une vérification avant l’export FEC.'}
          </p>
          <table>
            <thead><tr><th>Pièce</th><th>Écart</th></tr></thead>
            <tbody>
              {groupesDesequilibres.map((g) => {
                const piece = pieceById(g.pieceId)
                return (
                  <tr key={g.pieceId}>
                    <td>{piece?.tiers ?? piece?.nom_fichier ?? g.pieceId.slice(0, 8)}</td>
                    <td>{formatMoney(g.solde)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {categoriesSansCompte.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Comptes manquants</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces catégories sont utilisées par des pièces validées ou des mouvements affectés ou ventilés mais n'ont pas encore de
            compte comptable associé — les écritures correspondantes ne peuvent pas être générées tant que ce n'est pas fait. Un compte déjà
            renseigné est une suggestion à vérifier, pas une valeur figée — modifie-le avant d'enregistrer si besoin.
          </p>
          <table>
            <thead><tr><th>Catégorie</th><th>Compte</th><th></th></tr></thead>
            <tbody>
              {categoriesSansCompte.map((c) => (
                <tr key={c.id}>
                  <td>{c.libelle}</td>
                  <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', width: 120 }}
                      placeholder="ex. 606100"
                      value={compteAffiche(c)}
                      onChange={(e) => setComptesEdit((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                    {!comptesEdit[c.id] && SUGGESTIONS_COMPTE_PAR_CODE[c.code] && (
                      <span className="badge badge-neutral">suggestion</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => saveCompte(c.id)}>Enregistrer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(tvaDeductible > 0 || tvaCollectee > 0) && (
        <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <span className="muted" style={{ display: 'block' }}>TVA déductible (achats)</span>
            <strong>{formatMoney(tvaDeductible)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>TVA collectée (ventes)</span>
            <strong>{formatMoney(tvaCollectee)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Solde</span>
            <strong>{formatMoney(tvaCollectee - tvaDeductible)}</strong>
          </div>
          {/* Ces soldes datent la TVA à la date de chaque PIÈCE : ils ne disent donc pas ce qu'une
              déclaration doit contenir. C'est l'onglet TVA qui la prépare, en suivant la règle
              d'exigibilité du dossier — et c'est là que les déclarations déposées s'enregistrent et se
              comparent. */}
          <p className="muted" style={{ flexBasis: '100%', margin: 0 }}>
            Ces totaux datent la TVA à la date de chaque pièce. La déclaration se prépare dans l'onglet TVA,
            qui suit la date d'exigibilité (l'encaissement, sauf option pour les débits).
          </p>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <p className="muted" style={{ margin: 0 }}>
          {/* Une écriture validée n'est plus « proposée » : la validation l'a figée (lib/validationExercice.ts). */}
          {nbProposees} écriture{nbProposees > 1 ? 's' : ''} proposée{nbProposees > 1 ? 's' : ''}
          {nbValidees > 0 && ` — ${nbValidees} validée${nbValidees > 1 ? 's' : ''}`}
          {/* Sur une lecture partielle, ce compte n'est plus celui des pièces en attente : il y met
              aussi celles dont on n'a pas pu lire l'écriture. Il se tait plutôt que de l'affirmer. */}
          {enAttente.length > 0 && brouillonIncomplet === null && ` — ${enAttente.length} pièce${enAttente.length > 1 ? 's' : ''} en attente de génération`}
          {nbSansContrepartie > 0 && (
            <> — <span className="badge badge-warning">
              {modele.mode === 'engagement'
                ? `${nbSansContrepartie} facture${nbSansContrepartie > 1 ? 's' : ''} sans règlement rapproché`
                : `${nbSansContrepartie} en attente de rapprochement bancaire`}
            </span></>
          )}
          {piecesDesynchronisees.length > 0 && (
            <> — <span className="badge badge-danger">{piecesDesynchronisees.length} à régénérer</span></>
          )}
          {groupesDesequilibres.length > 0 && (
            <> — <span className="badge badge-danger">{groupesDesequilibres.length} déséquilibrée{groupesDesequilibres.length > 1 ? 's' : ''}</span></>
          )}
        </p>
        <button
          className="btn btn-primary btn-sm"
          disabled={generating || changementModele || enAttente.length === 0 || brouillonIncomplet !== null || biensSansOuverture}
          title={
            brouillonIncomplet
              ? `Lecture incomplète (${brouillonIncomplet}) — générer maintenant pourrait doubler des écritures déjà passées.`
              : biensSansOuverture
              ? `À-nouveaux lus incomplètement (${aNouveauxIncomplets}) — on ne sait pas quels biens la balance reprise porte déjà : leur acquisition s’écrirait une seconde fois.`
              : undefined
          }
          onClick={genererEcritures}
        >
          {generating
            ? 'Génération…'
            : `Générer les écritures manquantes${enAttente.length > 0 && brouillonIncomplet === null ? ` (${enAttente.length})` : ''}`}
        </button>
      </div>

      {/* LES PIÈCES QU'UN EXERCICE VALIDÉ EMPÊCHE D'ÉCRIRE, nommées plutôt que tues : la génération n'écrit rien au plus
          tard à la frontière, et une pièce déposée après la validation — une facture de l'exercice arrivée en retard —
          disparaîtrait sinon du compte sans un mot. Sur une lecture partielle, la liste se tait comme le compte. */}
      {frontiere && generation.dansUnExerciceValide.length > 0 && brouillonIncomplet === null && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Pièces datées d’un exercice validé</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Aucune écriture ne se passe plus au {formatDate(frontiere)} ou avant : ces pièces sans écriture n’en reçoivent
            que la part datée après. Une opération trouvée après la validation se corrige sur l’exercice suivant —
            l’exercice validé, lui, ne se rouvre pas.
          </p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Pièce</th><th>Montant</th><th>Date</th><th>Ce qui s’écrit</th></tr></thead>
              <tbody>
                {generation.dansUnExerciceValide.map(({ piece, suite }) => (
                  <tr key={piece.id}>
                    <td>{piece.tiers ?? piece.nom_fichier}</td>
                    <td>{formatMoney(piece.montant_ttc)}</td>
                    <td>{piece.date_piece ? formatDate(piece.date_piece) : <span className="muted">sans date</span>}</td>
                    <td>{CE_QUI_S_ECRIT[suite](formatDate(frontiere))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {brouillonIncomplet && (
        // Dit en clair ce que les trois boutons grisés ne peuvent qu'insinuer : les totaux affichés
        // eux-mêmes portent sur une lecture partielle.
        <p className="error-text">
          Le brouillon n'a pas pu être lu en entier ({brouillonIncomplet}). Les totaux ci-dessous
          portent donc sur une partie des écritures. La génération est suspendue — elle pourrait
          doubler des écritures déjà passées, ou comptabiliser un bien immobilisé — et les exports
          FEC et piste d'audit sont bloqués : un fichier fiscal amputé ne peut pas dire qu'il l'est.
          Recharge la page.
        </p>
      )}

      {error && <p className="error-text">{error}</p>}

      <BandeauLecturePartielle
        quoi="Les à-nouveaux du dossier"
        accord="lus"
        motif={aNouveauxIncomplets}
        consequence={
          'Les exports FEC et piste d’audit sont bloqués : ils s’ouvrent par eux, et un fichier fiscal dont ' +
          'l’ouverture est amputée ne peut pas le dire. La génération des écritures n’en dépend que pour la ' +
          'facture d’un bien : c’est l’ouverture qui dit s’il est acquis avant elle, donc déjà dans la balance ' +
          'reprise — elle attend donc une lecture complète tant qu’un bien est en attente, comme « Régénérer » ' +
          'sur la facture d’un bien. Recharge la page.'
        }
      />

      <BandeauLecturePartielle
        quoi="Les lettrages faits à la main"
        accord="lus"
        motif={lettragesManquants}
        consequence={
          'L’export du FEC est bloqué : une facture et l’avoir que le cabinet a lettrés ensemble y paraîtraient ' +
          'ouverts, et le fichier ne peut pas le dire. La génération des écritures et la piste d’audit n’en dépendent ' +
          'pas. Recharge la page.'
        }
      />

      {/* Les à-nouveaux ne sont pas des écritures du brouillon : le journal ci-dessous ne les montre
          pas. Sans cette phrase, un FEC qui s'ouvre par un journal AN surprendrait celui qui vient de
          parcourir la liste. */}
      {typeof anneeFilter === 'number' && aNouveauxExercice.length > 0 && (
        <p className="muted" style={{ fontSize: '0.85rem', textAlign: 'right', margin: '0 0 8px' }}>
          {`Exercice ouvert par ${aNouveauxExercice.length} à-nouveau${aNouveauxExercice.length > 1 ? 'x' : ''} `
            + `au ${formatDate(aNouveauxExercice[0].date)}, repris de ${aNouveauxExercice[0].source_nom} : `
            + `ils ouvrent le FEC et la piste d’audit de ${anneeFilter} (journal AN), sans figurer dans le journal ci-dessous.`}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        {horsFec.nb > 0 && (
          <span className="badge badge-danger" title="Le format FEC n'a pas de place pour le dire : c'est ici ou nulle part.">
            {/* « seront » et non « sera » + « ont » : l'accord s'écrivait « ne seraont » au pluriel,
                sur l'alerte qui dit ce que le fichier fiscal ne contiendra pas. */}
            {horsFec.nb} écriture{horsFec.nb > 1 ? 's' : ''} ne {horsFec.nb > 1 ? 'seront' : 'sera'} pas dans ce FEC
            {' '}({formatMoney(horsFec.debit - horsFec.credit)})
          </span>
        )}
        <button
          className="btn btn-outline btn-sm"
          disabled={
            typeof anneeFilter !== 'number' || (ecrituresFiltrees.length === 0 && aNouveauxExercice.length === 0)
            || brouillonIncomplet !== null || aNouveauxIncomplets !== null || lettragesManquants !== null
          }
          title={
            brouillonIncomplet
              ? `Brouillon lu incomplètement (${brouillonIncomplet}) — un FEC amputé ne peut pas le dire, le format n'a pas de place pour ça.`
              : aNouveauxIncomplets
              ? `À-nouveaux lus incomplètement (${aNouveauxIncomplets}) — le FEC s'ouvrirait sur une ouverture amputée.`
              : lettragesManquants
              ? `Lettrages faits à la main lus incomplètement (${lettragesManquants}) — une facture lettrée paraîtrait ouverte dans le FEC.`
              : typeof anneeFilter !== 'number' ? "Sélectionne une année ci-dessus — le FEC est un fichier par exercice."
              : fecValide ? 'Exercice validé : son FEC se relit tel que la validation l’a figé — journal, numéros et libellés ne changent plus.'
              : undefined
          }
          onClick={() => {
            if (typeof anneeFilter !== 'number') return
            const contenu = fecValide
              ? formaterFec(fecValide, lettrage)
              : genererFec(ecrituresFiltrees, piecesValidees, categories, aNouveauxExercice, modele.mode, lignesBancaires, lettrage)
            telechargerTexte(nomFichierFec(dossierSiret, anneeFilter), contenu)
          }}
        >
          Exporter FEC {typeof anneeFilter === 'number' ? anneeFilter : ''}{fecValide ? ' (validé)' : ''}
        </button>
        <button
          className="btn btn-outline btn-sm"
          disabled={typeof anneeFilter !== 'number' || exportPiste || brouillonIncomplet !== null || aNouveauxIncomplets !== null}
          title={
            brouillonIncomplet
              ? `Brouillon lu incomplètement (${brouillonIncomplet}) — une piste d'audit partielle est pire qu'absente.`
              : aNouveauxIncomplets
              ? `À-nouveaux lus incomplètement (${aNouveauxIncomplets}) — une piste d'audit partielle est pire qu'absente.`
              : typeof anneeFilter !== 'number'
              ? "Sélectionne une année ci-dessus — une piste d'audit se produit par exercice."
              : "Chaque écriture avec son justificatif (tiers, date, montant, fichier, empreinte SHA-256) et l'opération bancaire réelle, plus les justificatifs validés que rien ne comptabilise."
          }
          onClick={exporterPisteAudit}
        >
          {exportPiste ? 'Export…' : `Exporter la piste d'audit ${typeof anneeFilter === 'number' ? anneeFilter : ''}`}
        </button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un compte, un libellé, un montant…"
          affiches={ecrituresAffichees.length}
          total={ecrituresFiltrees.length}
        />
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : ecrituresAffichees.length === 0 ? (
          <div className="empty-state">
            {recherche.trim() ? `Aucune écriture ne correspond à « ${recherche.trim()} ».` : "Aucune écriture proposée pour l'instant."}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Compte</th>
                <th>Libellé</th>
                <th>Montant</th>
                <th>Sens</th>
              </tr>
            </thead>
            <tbody>
              {ecrituresAffichees.map((e) => (
                <tr key={e.id}>
                  <td>
                    {formatDate(e.date)}
                    {e.statut === 'validee' && (
                      <>{' '}<span className="badge badge-ok" title="Exercice validé : cette écriture ne se modifie ni ne se retire plus.">validée</span></>
                    )}
                  </td>
                  <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {e.compte}
                    {/* Le lettrage de la ligne (lib/lettrage.ts) : la facture et les règlements qui la soldent portent le
                        même code, celui du FEC (EcritureLet). */}
                    {lettrage.has(e.id) && (
                      <>{' '}<span className="badge badge-neutral" title={`Lettrée le ${formatDate(lettrage.get(e.id)!.date)} : les lignes de ce code se soldent sur ce compte — une facture et ses règlements, ou les pièces lettrées à la main.`}>
                        lettrage {lettrage.get(e.id)!.code}
                      </span></>
                    )}
                  </td>
                  <td>{e.libelle}</td>
                  <td>{formatMoney(e.montant)}</td>
                  <td>
                    {e.sens === 'debit'
                      ? <span className="badge badge-neutral">Débit</span>
                      : <span className="badge badge-ok">Crédit</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
