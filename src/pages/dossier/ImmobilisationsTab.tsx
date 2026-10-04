import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { lireTout } from '../../lib/lectureComplete'
import { anneeDe, aujourdHuiSql, dateLocaleDe, formatDate, formatMoney } from '../../lib/format'
import {
  compteAmortissement, dateDeLaDotation, dotationDeLExercice, dotationsDuRegistre, dotationsEnDefaut, montantDeFactureDifferent,
  planAmortissement, refusBien, refusNature, valeurSaisie,
  type DotationDuRegistre, type EtatDotation,
} from '../../lib/amortissements'
import { immobilisationSansJustificatif } from '../../lib/controles'
import type { ANouveau, EcritureBrouillon, Immobilisation, NatureImmobilisation, Piece } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import { messageErreur } from '../../lib/messageErreur'
import { montantRetenu } from '../../lib/montantRetenu'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'

// Seuil au-delà duquel une dépense est candidate à l'immobilisation plutôt qu'à la charge courante.
// Valeur usuelle citée dans le document d'architecture — pas encore configurable par dossier, cette
// version couvre le cas standard.
const SEUIL_IMMOBILISATION = 500
const DUREE_DEFAUT_ANNEES = 5
const COMPTE_IMMOBILISATION_DEFAUT = '218000'

const LIBELLE_ETAT: Record<EtatDotation, string> = {
  a_ecrire: 'À écrire',
  a_reecrire: 'À réécrire',
  a_retirer: 'À retirer',
  ecrite: 'Écrite',
  validee: 'Validée, ne suit plus le registre',
}

// Ce que la Checklist réclame, dit dans la carte — accordé, la phrase se lisant d'un coup d'œil.
function phraseEnDefaut(n: number): string {
  return n === 1
    ? '1 dotation manque à un exercice fini ou ne suit plus le registre : la Checklist la réclame.'
    : `${n} dotations manquent à un exercice fini ou ne suivent plus le registre : la Checklist les réclame.`
}

interface BienEnEdition {
  libelle: string
  natureId: string
  valeur: string
  dateAcquisition: string
  dateMiseEnService: string
  duree: string
}

// Palier 5, brique 2 — registre des immobilisations. Une pièce validée dépassant le seuil est
// proposée comme candidate ; c'est toujours le cabinet qui décide de l'enregistrer comme telle
// (jamais automatique). La nature du bien (téléphone, véhicule...) suggère une durée d'amortissement
// usuelle et donne son COMPTE — d'où vient le compte 28 que la dotation crédite.
//
// LES DOTATIONS S'ÉCRIVENT DEPUIS CET ÉCRAN (ligne 26.6, étape b — lib/amortissements.ts) : chaque bien,
// chaque exercice de son tableau d'amortissement, comparé au brouillon. « Écrire les N » les écrit par la
// fonction de la base, qui refait le calcul et refuse une écriture qui ne vaut pas sa dotation au centime.
// Rien ne s'écrit sans ce clic. L'amortissement est celui de la règle fiscale — prorata temporis depuis la
// mise en service, le reliquat après la durée —, et la colonne « Dotation » le montre : elle affichait
// jusqu'au 01/10/2026 l'annuité pleine dès l'acquisition, sous une réserve qui disait de la reprendre.
export default function ImmobilisationsTab({ dossierId, assujettiTva }: { dossierId: string; assujettiTva: boolean }) {
  const [piecesValidees, setPiecesValidees] = useState<Piece[]>([])
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [natures, setNatures] = useState<NatureImmobilisation[]>([])
  const [ecrituresDotations, setEcrituresDotations] = useState<EcritureBrouillon[]>([])
  const [ouverture, setOuverture] = useState<string | null>(null)
  // À PART de `lectureIncomplete` : ce sont les dotations écrites, les natures (leurs comptes) et
  // l'ouverture du dossier qui décident de ce que « Écrire les N » écrirait. Lues en partie, l'écriture se
  // suspend — un bandeau ne suffit pas quand un bouton à côté écrit (CLAUDE.md, « une lecture partielle ne
  // commande pas d'écriture »).
  const [dotationsIncompletes, setDotationsIncompletes] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [naturesChoisies, setNaturesChoisies] = useState<Record<string, string>>({})
  const [durees, setDurees] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')
  const [recherche, setRecherche] = useState('')
  const [plansOuverts, setPlansOuverts] = useState<Set<string>>(new Set())
  const [edition, setEdition] = useState<{ id: string; bien: BienEnEdition } | null>(null)
  const [nouvelleNature, setNouvelleNature] = useState({ libelle: '', duree: String(DUREE_DEFAUT_ANNEES), compte: COMPTE_IMMOBILISATION_DEFAUT })
  // Le formulaire d'une nouvelle nature s'ouvre là où on l'a demandé : dans la carte des candidates, où
  // l'on cherche la nature d'une pièce, ou dans celle des natures.
  const [natureOuverte, setNatureOuverte] = useState<'candidates' | 'natures' | null>(null)
  // UN verrou pour les gestes qui écrivent le registre ou ses dotations : « Écrire les N », « Retirer » et
  // « Enregistrer » une modification. Retiré ou modifié pendant le lot, un bien verrait sa dotation écrite
  // par le lot, qui l'a composée avant. Un `useRef`, posé avant le premier `await` et relâché dans un
  // `finally`, APRÈS la relecture (voir CLAUDE.md, « un verrou d'exécution »).
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)
  const natureEnCours = useRef(false)

  // `loading` ne repasse pas à vrai au rechargement : après une écriture, l'écran garde ce qu'il montrait —
  // bouton grisé sous le verrou — jusqu'à ce que la relecture revienne, au lieu de vider la carte qu'on
  // vient d'utiliser. Un autre dossier remonte l'onglet (`AnneeProvider key`), donc repart à vrai.
  async function load() {
    const [lecturePieces, lectureImmobilisations, lectureNatures, lectureDotations, lectureOuverture] = await Promise.all([
      // Lue par tranches (voir lib/lectureComplete.ts) : c'est parmi ces pièces qu'on choisit celle
      // à immobiliser, et une liste tronquée ne paraît pas tronquée.
      // `piecesValidees` et non `pieces` : la lecture ne rend QUE les validées, et le filtre est
      // juste — on immobilise une facture vérifiée, pas une pièce en attente d'arbitrage. C'est le
      // NOM qui mentait. Cet écran est le seul des sept à avoir échappé au renommage de 2026 (voir
      // CLAUDE.md, « un nom qui ment sur son filtre »).
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
      ),
      lireTout<Immobilisation>((debut, fin) =>
        supabase.from('immobilisations').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date_acquisition', { ascending: false }).order('id').range(debut, fin),
      ),
      lireTout<NatureImmobilisation>((debut, fin) =>
        supabase.from('natures_immobilisation').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre').order('id').range(debut, fin),
      ),
      // Les dotations ÉCRITES au brouillon : celles qu'on compare au tableau d'amortissement.
      lireTout<EcritureBrouillon>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).not('immobilisation_id', 'is', null).order('date').order('id').range(debut, fin),
      ),
      // L'ouverture du dossier : avant elle, l'amortissement est dans les à-nouveaux et ne s'écrit pas.
      lireTout<Pick<ANouveau, 'id' | 'date'>>((debut, fin) =>
        supabase.from('a_nouveaux').select('id, date', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin),
      ),
    ])
    setPiecesValidees(lecturePieces.lignes)
    setImmobilisations(lectureImmobilisations.lignes)
    setNatures(lectureNatures.lignes)
    setEcrituresDotations(lectureDotations.lignes)
    setOuverture(lectureOuverture.lignes[0]?.date ?? null)
    setLectureIncomplete([lecturePieces, lectureImmobilisations].find((l) => !l.complete)?.motif ?? null)
    setDotationsIncompletes(
      [lectureImmobilisations, lectureNatures, lectureDotations, lectureOuverture].find((l) => !l.complete)?.motif ?? null,
    )
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  // L'exercice en cours, lu à chaque rendu : un onglet laissé ouvert au passage d'une année doit passer à la
  // nouvelle (voir CLAUDE.md, « maintenant lu au chargement d'un module est figé »).
  const anneeCourante = anneeDe(aujourdHuiSql())
  const natureParId = new Map(natures.map((n) => [n.id, n]))

  const dejaEnregistrees = new Set(immobilisations.map((i) => i.piece_id).filter(Boolean))
  // La valeur d'un bien est celle qui s'amortit : hors taxes pour un dossier assujetti, qui récupère la
  // TVA, TVA comprise pour un dossier exonéré, pour qui elle fait partie du prix de revient (voir
  // lib/montantRetenu.ts). Le seuil se juge sur la même valeur que celle qu'on affiche et qu'on
  // enregistre : l'enregistrer au TTC faisait amortir chez un assujetti une TVA qu'il récupère déjà.
  const candidates = piecesValidees.filter((p) => {
    const valeur = montantRetenu(p, assujettiTva)
    return valeur != null && valeur >= SEUIL_IMMOBILISATION && !dejaEnregistrees.has(p.id)
  })
  const natureLabel = (id: string | null) => (id ? natureParId.get(id)?.libelle : undefined) ?? '—'

  // L'EXERCICE choisi est celui dont la colonne « Dotation » montre la dotation, et le registre en montre les
  // biens : ceux acquis au plus tard cette année-là, amortis ou non — le tableau des immobilisations d'un
  // exercice, celui que la case CH totalise. Il filtrait jusqu'au 01/10/2026 sur l'année d'ACQUISITION, ce qui
  // ne disait rien d'une dotation : un bien de 2023 a la sienne en 2025. Les candidates restent toujours toutes
  // affichées (une pièce ancienne oubliée reste à traiter quelle que soit l'année sélectionnée).
  const premiereAcquisition = immobilisations.length > 0 ? Math.min(...immobilisations.map((i) => anneeDe(i.date_acquisition))) : null
  const derniereAnnee = Math.max(anneeCourante, ...immobilisations.map((i) => anneeDe(i.date_acquisition)))
  const anneesDisponibles = premiereAcquisition == null
    ? []
    : Array.from({ length: derniereAnnee - premiereAcquisition + 1 }, (_, k) => derniereAnnee - k)
  const immobilisationsFiltrees = anneeFilter === 'toutes'
    ? immobilisations
    : immobilisations.filter((i) => typeof anneeFilter === 'number' && anneeDe(i.date_acquisition) <= anneeFilter)
  // « Toutes » : la colonne montre l'exercice en cours.
  const exerciceAffiche = typeof anneeFilter === 'number' ? anneeFilter : anneeCourante

  // La recherche ne porte que sur le registre, pas sur les candidates : celles-ci sont une liste de
  // tâches à traiter, bornée par le seuil, et en masquer une derrière un filtre de texte reviendrait
  // à la faire oublier.
  const immobilisationsAffichees = immobilisationsFiltrees.filter((i) =>
    correspondALaRecherche(
      [i.libelle, natureLabel(i.nature_id), i.valeur, i.date_acquisition, formatDate(i.date_acquisition), i.duree_annees],
      recherche,
    ),
  )

  // LES DOTATIONS DU REGISTRE, sur le registre ENTIER — jamais sur ce qu'une recherche ou un exercice
  // laisse voir : une dotation à écrire ne disparaît pas d'un mot tapé (la règle « une recherche filtre
  // l'affichage, jamais un total », prise par son côté le plus coûteux).
  const dotations = dotationsDuRegistre(immobilisations, natures, ecrituresDotations, ouverture, anneeCourante)
  const aTraiter = dotations.filter((d) => d.etat !== 'ecrite')
  const aEcrire = aTraiter.filter((d) => d.etat !== 'validee' && !d.refus)
  // Ce que la Checklist réclame : un exercice révolu sans sa dotation, ou une dotation qui ne suit plus le
  // registre. La dotation de l'exercice EN COURS peut s'écrire dès aujourd'hui sans manquer encore : la
  // carte la propose sans s'alarmer, sans quoi elle serait en alerte toute l'année.
  const enDefaut = dotationsEnDefaut(dotations, anneeCourante)
  const ecritureSuspendue = dotationsIncompletes !== null
  const dotationsDuBien = (id: string) => dotations.filter((d) => d.immobilisation.id === id)

  // La valeur d'un bien qui ne suit plus sa FACTURE : l'acquisition s'écrit au montant de la facture, les
  // dotations sur la valeur du registre (lib/amortissements.ts). Comptée sur le registre ENTIER, comme les
  // dotations : un mot tapé dans la recherche ne fait pas disparaître l'écart. Rien pour un bien acquis
  // avant l'ouverture du dossier : son acquisition ne s'écrit pas, la balance reprise porte sa valeur.
  const factureParPiece = new Map(piecesValidees.map((p) => [p.id, p]))
  const factureDifferente = (i: Immobilisation) =>
    i.piece_id ? montantDeFactureDifferent(i, factureParPiece.get(i.piece_id), assujettiTva, ouverture) : null
  const nbValeursHorsFacture = immobilisations.filter((i) => factureDifferente(i) != null).length

  // Changer la nature choisie pré-remplit la durée suggérée, sans écraser une durée déjà modifiée à la
  // main pour cette pièce.
  function choisirNature(pieceId: string, natureId: string) {
    setNaturesChoisies((prev) => ({ ...prev, [pieceId]: natureId }))
    const nature = natureParId.get(natureId)
    if (nature && !durees[pieceId]) {
      setDurees((prev) => ({ ...prev, [pieceId]: String(nature.duree_annees_defaut) }))
    }
  }

  // Une nature PROPRE au dossier, avec son compte : les natures partagées par le cabinet portent le leur, et
  // seul un super-administrateur les modifie (policy de `natures_immobilisation`).
  async function ajouterNature(e: FormEvent) {
    e.preventDefault()
    if (natureEnCours.current) return
    const refus = refusNature(nouvelleNature)
    if (refus) {
      setError(refus)
      return
    }
    natureEnCours.current = true
    try {
      const { error: insertError } = await supabase.from('natures_immobilisation').insert({
        dossier_id: dossierId,
        libelle: nouvelleNature.libelle.trim(),
        duree_annees_defaut: Number(nouvelleNature.duree),
        compte_immobilisation: nouvelleNature.compte.trim(),
      })
      if (insertError) {
        setError(`La nature n’a pas pu être ajoutée : ${messageErreur(insertError, 'raison inconnue')}`)
        return
      }
      setError(null)
      setNouvelleNature({ libelle: '', duree: String(DUREE_DEFAUT_ANNEES), compte: COMPTE_IMMOBILISATION_DEFAUT })
      setNatureOuverte(null)
      await load()
    } finally {
      natureEnCours.current = false
    }
  }

  async function enregistrer(piece: Piece) {
    const duree = parseInt(durees[piece.id] ?? String(DUREE_DEFAUT_ANNEES), 10)
    if (!duree || duree < 1) {
      setError('Durée invalide.')
      return
    }
    // La nature d'abord : c'est elle qui donne le compte d'amortissement, sans lequel la dotation du bien ne
    // pourrait pas s'écrire. La demander ici coûte un clic ; l'oublier laissait le bien sans compte.
    if (!naturesChoisies[piece.id]) {
      setError('Choisissez la nature du bien : c’est elle qui donne son compte d’amortissement.')
      return
    }
    setSaving(piece.id)
    setError(null)
    try {
      const { error: insertError } = await supabase.from('immobilisations').insert({
        dossier_id: dossierId,
        piece_id: piece.id,
        nature_id: naturesChoisies[piece.id],
        libelle: piece.tiers ?? piece.nom_fichier,
        valeur: montantRetenu(piece, assujettiTva),
        date_acquisition: piece.date_piece ?? dateLocaleDe(piece.created_at),
        duree_annees: duree,
      })
      if (insertError) throw insertError
      load()
    } catch (err) {
      // Contrainte unique sur piece_id (voir migration immobilisations_piece_id_unique) : deux onglets
      // ouverts, un double-clic ou une liste d'immobilisations lue à moitié peuvent tenter
      // d'enregistrer la même pièce deux fois.
      //
      // Reconnue à son CODE, jamais à l'héritage : l'erreur arrive ici par `throw insertError`, un
      // objet Postgrest NU, qui n'est pas une instance d'`Error`. Le test `err instanceof Error`
      // d'avant rendait donc ce message impossible — l'opérateur lisait la phrase brute de Postgres,
      // et la liste n'était pas relue (voir lib/messageErreur.ts, même défaut sous une autre forme).
      if ((err as { code?: unknown } | null)?.code === '23505') {
        setError('Cette pièce a déjà été enregistrée comme immobilisation.')
        load()
        return
      }
      setError(messageErreur(err))
    } finally {
      setSaving(null)
    }
  }

  // PAR LA BASE, PLUS PAR UNE SUPPRESSION DIRECTE : la clé d'une dotation vers son bien est sans action, et
  // `retirer_immobilisation` retire le bien ET ses dotations écrites en une transaction — elle refuse si
  // l'une est validée. La suppression d'avant jetait son erreur : le bien réapparaissait au rechargement,
  // sans un mot. La confirmation NOMME ce qui part avec lui.
  async function retirer(i: Immobilisation) {
    if (ecritureEnCours.current) return
    const sesDotations = ecrituresDotations.filter((e) => e.immobilisation_id === i.id)
    if (sesDotations.some((e) => e.statut !== 'proposee')) {
      setError('Une dotation de ce bien est validée : il ne se retire plus.')
      return
    }
    // La phrase « la pièce redevient une charge » suppose qu'il RESTE une pièce. Sur une
    // immobilisation dont le justificatif a été supprimé — l'état que signale
    // `immobilisationSansJustificatif`, et dont l'action recommandée EST ce bouton — elle est
    // fausse, et elle rassure à l'envers : rien ne redevient une charge, et le retrait efface la
    // dernière trace comptable de la dépense (plus de pièce, donc plus d'amortissement non plus).
    const confirmation = immobilisationSansJustificatif(i)
      ? 'Retirer cette immobilisation ? Son justificatif a déjà été supprimé : l’amortissement '
        + 'disparaît de la 2035 et rien ne le remplace — cette dépense ne sera plus comptée nulle part.'
      : 'Retirer cette immobilisation ? La pièce redevient une charge courante ordinaire.'
    // Sur une lecture partielle des dotations, la liste des exercices pourrait en oublier : on ne la cite
    // pas, et on dit pourquoi. La base, elle, les retire toutes.
    const exercices = [...new Set(sesDotations.map((e) => anneeDe(e.date)))].sort((a, b) => a - b)
    const dotationsQuiPartent = dotationsIncompletes
      ? ' Ses dotations écrites au brouillon partent avec lui — leur liste n’a pas pu être lue en entier.'
      : exercices.length > 0
        ? ` Ses dotations écrites au brouillon (${exercices.join(', ')}) partent avec lui.`
        : ''
    if (!window.confirm(confirmation + dotationsQuiPartent)) return
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const { error: erreurRetrait } = await supabase.rpc('retirer_immobilisation', { p_immobilisation_id: i.id })
      if (erreurRetrait) setError(`Le bien n’a pas pu être retiré : ${messageErreur(erreurRetrait, 'raison inconnue')}`)
      await load()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  function ouvrirEdition(i: Immobilisation) {
    setError(null)
    setEdition({
      id: i.id,
      bien: {
        libelle: i.libelle, natureId: i.nature_id ?? '', valeur: String(i.valeur), dateAcquisition: i.date_acquisition,
        dateMiseEnService: i.date_mise_en_service ?? '', duree: String(i.duree_annees),
      },
    })
  }

  // Modifier un bien ne réécrit PAS ses dotations : le tableau les dira « à réécrire », et c'est le clic sur
  // « Écrire les N » qui les remplace. Une modification n'écrit rien d'autre que le bien.
  async function enregistrerEdition(e: FormEvent) {
    e.preventDefault()
    if (!edition || ecritureEnCours.current) return
    const b = edition.bien
    const refus = refusBien({ libelle: b.libelle, valeur: b.valeur, dateAcquisition: b.dateAcquisition, dateMiseEnService: b.dateMiseEnService, duree: b.duree })
    if (refus) {
      setError(refus)
      return
    }
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const { error: erreurModification } = await supabase.from('immobilisations').update({
        libelle: b.libelle.trim(),
        nature_id: b.natureId || null,
        valeur: Math.round(valeurSaisie(b.valeur) * 100) / 100,
        date_acquisition: b.dateAcquisition,
        date_mise_en_service: b.dateMiseEnService || null,
        duree_annees: Number(b.duree),
      }).eq('id', edition.id)
      if (erreurModification) {
        setError(`Le bien n’a pas pu être modifié : ${messageErreur(erreurModification, 'raison inconnue')}`)
        return
      }
      setError(null)
      setEdition(null)
      await load()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  // Chaque dotation par la fonction de la base, une à une : elle refait le calcul, vérifie l'écriture et
  // remplace celle qui ne correspond plus — une dotation à retirer part avec une écriture vide. Un échec
  // n'interrompt pas le lot, et se dit. Le verrou se relâche APRÈS la relecture : relâché avant, la carte
  // montrerait encore « Écrire les N » sur des dotations déjà écrites, le temps qu'elle revienne.
  async function ecrireLesDotations() {
    if (ecritureEnCours.current || ecritureSuspendue || aEcrire.length === 0) return
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const echecs: string[] = []
      for (const d of aEcrire) {
        const { error: erreurEcriture } = await supabase.rpc('ecrire_dotation_amortissement', {
          p_immobilisation_id: d.immobilisation.id,
          p_annee: d.annee,
          p_ecritures: d.attendues ?? [],
        })
        if (erreurEcriture) echecs.push(`${d.immobilisation.libelle} (${d.annee}) : ${messageErreur(erreurEcriture, 'raison inconnue')}`)
      }
      setError(echecs.length > 0
        ? `Dotations écrites : ${aEcrire.length - echecs.length} sur ${aEcrire.length}. `
          + `Refusée${echecs.length > 1 ? 's' : ''} par la base : ${echecs.join(' ; ')}`
        : null)
      await load()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  function basculerPlan(id: string) {
    setPlansOuverts((prev) => {
      const suivant = new Set(prev)
      if (suivant.has(id)) suivant.delete(id)
      else suivant.add(id)
      return suivant
    })
  }

  // Ce que dit le tableau d'un exercice de son plan : l'état de son écriture, ou pourquoi il n'en a pas.
  function etatDeLExercice(i: Immobilisation, annee: number): string {
    const d = dotationsDuBien(i.id).find((x) => x.annee === annee)
    if (d) return LIBELLE_ETAT[d.etat]
    if (annee > anneeCourante) return 'À venir'
    if (ouverture && dateDeLaDotation(annee) < ouverture) return 'Dans les à-nouveaux'
    return '—'
  }

  const compteDe = (n: NatureImmobilisation) => `${n.compte_immobilisation} → ${compteAmortissement(n.compte_immobilisation)}`

  const formulaireNature = (
    <form onSubmit={ajouterNature} aria-label="Ajouter une nature" style={{ marginBottom: 12 }}>
      <div className="field-row aligne-bas">
        <label className="field">
          Nom
          <input value={nouvelleNature.libelle} placeholder="Matériel médical, mobilier…" onChange={(e) => setNouvelleNature({ ...nouvelleNature, libelle: e.target.value })} />
        </label>
        <label className="field">
          Durée usuelle (années)
          <input type="number" min={1} value={nouvelleNature.duree} onChange={(e) => setNouvelleNature({ ...nouvelleNature, duree: e.target.value })} />
        </label>
        <label className="field">
          Compte d’immobilisation
          <input inputMode="numeric" value={nouvelleNature.compte} onChange={(e) => setNouvelleNature({ ...nouvelleNature, compte: e.target.value })} />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary btn-sm">Ajouter</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setNatureOuverte(null)}>Annuler</button>
        </div>
      </div>
    </form>
  )

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les immobilisations et les pièces validées"
        motif={lectureIncomplete}
        consequence={
          'Le tableau d’amortissement et le total des dotations ci-dessous portent donc sur une partie ' +
          'du dossier, et une pièce déjà immobilisée peut réapparaître dans les candidates.'
        }
      />
      <BandeauLecturePartielle
        quoi="Les dotations écrites au brouillon, les natures, les immobilisations ou l’ouverture du dossier"
        motif={dotationsIncompletes}
        consequence={
          'L’état des dotations ci-dessous peut être faux — une dotation écrite peut y paraître à écrire — : '
          + 'leur écriture est suspendue jusqu’au rechargement de la page.'
        }
      />
      <BrouillonBanner />

      {candidates.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ marginTop: 0 }}>Candidates à l'immobilisation</h3>
            {natureOuverte !== 'candidates' && (
              <button className="btn btn-outline btn-sm" onClick={() => setNatureOuverte('candidates')}>+ Nature</button>
            )}
          </div>
          {natureOuverte === 'candidates' && formulaireNature}
          <p className="muted">
            Pièces validées de {formatMoney(SEUIL_IMMOBILISATION)} ou plus — à toi de décider si c'est un
            investissement (matériel, véhicule…) ou une simple charge importante. La nature suggère une
            durée usuelle, toujours modifiable, et donne le compte du bien. {assujettiTva
              ? 'Montants hors taxes : le dossier est assujetti et récupère la TVA.'
              : 'Montants TVA comprise : le dossier est exonéré, la TVA fait partie du prix.'}
          </p>
          {/* Dans un conteneur qui défile, comme les autres tableaux : avec le panneau de droite ouvert,
              la colonne du bouton débordait du panneau central et passait sous le volet. Et
              `table-formulaire` : une ligne se REMPLIT, donc dans une carte étroite — téléphone, volet
              ouvert — elle se replie en fiche empilée au lieu de se comprimer jusqu'à couper le bouton.
              `formulaire-adaptable` est l'enveloppe dont la largeur en décide — voir index.css. */}
          <div className="table-scroll formulaire-adaptable">
            <table className="table-formulaire">
              <thead>
                <tr>
                  <th>Pièce</th>
                  <th>Montant</th>
                  <th style={{ width: 200 }}>Nature</th>
                  <th style={{ width: 110 }}>Durée (années)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((p) => (
                  <tr key={p.id}>
                    <td data-libelle="Pièce">{p.tiers ?? p.nom_fichier}</td>
                    <td data-libelle="Montant">{formatMoney(montantRetenu(p, assujettiTva))}</td>
                    <td data-libelle="Nature">
                      <select
                        aria-label={`Nature de ${p.tiers ?? p.nom_fichier}`}
                        style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px' }}
                        value={naturesChoisies[p.id] ?? ''}
                        onChange={(e) => choisirNature(p.id, e.target.value)}
                      >
                        <option value="">— Choisir —</option>
                        {natures.map((n) => <option key={n.id} value={n.id}>{n.libelle}</option>)}
                      </select>
                    </td>
                    <td data-libelle="Durée (années)">
                      <input
                        type="number"
                        min={1}
                        aria-label={`Durée de ${p.tiers ?? p.nom_fichier}`}
                        style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px' }}
                        placeholder={String(DUREE_DEFAUT_ANNEES)}
                        value={durees[p.id] ?? ''}
                        onChange={(e) => setDurees((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      />
                    </td>
                    <td className="td-action">
                      <button className="btn btn-outline btn-sm" disabled={saving === p.id} onClick={() => enregistrer(p)}>
                        {saving === p.id ? 'Enregistrement…' : 'Enregistrer comme immobilisation'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      {!loading && aTraiter.length > 0 && (
        <div className="card" style={{ marginBottom: 20, ...(enDefaut.length > 0 ? { borderLeft: '3px solid var(--color-warning)' } : {}) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ marginTop: 0 }}>Dotations aux amortissements à écrire ({aTraiter.length})</h3>
            {aEcrire.length > 0 && (
              <button
                className="btn btn-primary btn-sm"
                disabled={enCours || ecritureSuspendue}
                onClick={ecrireLesDotations}
              >
                {enCours ? 'Écriture…' : aEcrire.length === 1 ? 'Écrire cette dotation' : `Écrire les ${aEcrire.length}`}
              </button>
            )}
          </div>
          <p className="muted">
            Chaque dotation s’écrit au 31 décembre de son exercice : le compte 681100 au débit, le compte
            d’amortissement du bien au crédit — celui que sa nature donne. Elle compte prorata temporis depuis la
            mise en service, et le FEC la porte au journal des opérations diverses. Celle de l’exercice en cours
            peut s’écrire dès aujourd’hui ; la Checklist ne la réclame qu’une fois l’exercice fini. Un exercice
            tenu dans un autre logiciel s’ouvre par une balance reprise (onglet Informations) : ses dotations sont
            alors dans les à-nouveaux, et ne se demandent plus ici.
          </p>
          {enDefaut.length > 0 && (
            <p><strong>{phraseEnDefaut(enDefaut.length)}</strong></p>
          )}
          {ecritureSuspendue && (
            <p className="error-text">Écriture suspendue : une lecture est partielle (voir plus haut). Rechargez la page.</p>
          )}
          <div className="table-scroll">
            <table aria-label="Dotations à écrire">
              <thead>
                <tr>
                  <th>Bien</th>
                  <th>Exercice</th>
                  <th style={{ textAlign: 'right' }}>Dotation</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {aTraiter.map((d: DotationDuRegistre) => (
                  <tr key={`${d.immobilisation.id}-${d.annee}`}>
                    <td>{d.immobilisation.libelle}</td>
                    <td>{d.annee}{d.annee === anneeCourante ? ' (en cours)' : ''}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(d.montant)}</td>
                    <td>
                      {LIBELLE_ETAT[d.etat]}
                      {d.refus && <div className="muted" style={{ fontSize: '0.85em' }}>{d.refus}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

      {nbValeursHorsFacture > 0 && (
        <p className="muted" style={{ marginTop: 0 }}>
          {nbValeursHorsFacture === 1 ? 'Un bien n’est pas enregistré' : `${nbValeursHorsFacture} biens ne sont pas enregistrés`} au
          montant de {nbValeursHorsFacture === 1 ? 'sa facture' : 'leur facture'} (badge « Facture : … ») : l’acquisition s’écrit au
          montant de la facture{assujettiTva ? ' hors taxe' : ''}, les dotations sur la valeur du registre, et le compte du bien ne se
          recoupe plus avec son amortissement. Corriger la valeur — ou, si la facture porte aussi des charges, savoir qu’elle
          s’écrit en entier sur le compte du bien.
        </p>
      )}

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un libellé, une nature, un montant…"
          affiches={immobilisationsAffichees.length}
          total={immobilisationsFiltrees.length}
        />
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : immobilisationsAffichees.length === 0 ? (
          <div className="empty-state">
            {recherche.trim()
              ? `Aucune immobilisation ne correspond à « ${recherche.trim()} ».`
              : "Aucune immobilisation enregistrée pour l'instant."}
          </div>
        ) : (
          <table aria-label="Registre des immobilisations">
            <thead>
              <tr>
                <th>Libellé</th>
                <th>Nature</th>
                <th>Valeur</th>
                <th>Acquisition</th>
                <th>Mise en service</th>
                <th>Durée</th>
                <th>Dotation {exerciceAffiche}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {immobilisationsAffichees.map((i) => (
                <Fragment key={i.id}>
                  <tr>
                    <td>
                      {i.libelle}
                      {/* `piece_id` nul ne peut venir que d'une pièce supprimée : le seul chemin de
                          création de cet écran pose toujours le lien. La dotation, elle, continue de
                          partir en case CH — voir `immobilisationSansJustificatif`. */}
                      {immobilisationSansJustificatif(i) && (
                        <span className="badge badge-danger" style={{ marginLeft: 8 }}>Justificatif supprimé</span>
                      )}
                    </td>
                    <td>
                      {natureLabel(i.nature_id)}
                      {!i.nature_id && <span className="badge badge-warning" style={{ marginLeft: 8 }}>Nature à choisir</span>}
                    </td>
                    <td>
                      {formatMoney(i.valeur)}
                      {factureDifferente(i) != null && (
                        <span className="badge badge-warning" style={{ marginLeft: 8 }}>Facture : {formatMoney(factureDifferente(i))}</span>
                      )}
                    </td>
                    <td>{formatDate(i.date_acquisition)}</td>
                    <td>
                      {i.date_mise_en_service ? formatDate(i.date_mise_en_service) : <span className="muted">à l’acquisition</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{i.duree_annees} an{i.duree_annees > 1 ? 's' : ''}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(dotationDeLExercice(i, exerciceAffiche))}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button className="btn btn-outline btn-sm" aria-expanded={plansOuverts.has(i.id)} onClick={() => basculerPlan(i.id)}>
                          Tableau
                        </button>
                        <button className="btn btn-outline btn-sm" disabled={enCours} onClick={() => ouvrirEdition(i)}>Modifier</button>
                        <button className="btn btn-danger btn-sm" disabled={enCours} onClick={() => retirer(i)}>Retirer</button>
                      </div>
                    </td>
                  </tr>
                  {edition?.id === i.id && (
                    <tr>
                      <td colSpan={8}>
                        <form onSubmit={enregistrerEdition} aria-label={`Modifier ${i.libelle}`}>
                          <div className="field-row">
                            <label className="field">
                              Libellé
                              <input value={edition.bien.libelle} onChange={(e) => setEdition({ ...edition, bien: { ...edition.bien, libelle: e.target.value } })} />
                            </label>
                            <label className="field">
                              Nature
                              <select value={edition.bien.natureId} onChange={(e) => setEdition({ ...edition, bien: { ...edition.bien, natureId: e.target.value } })}>
                                <option value="">— Choisir —</option>
                                {natures.map((n) => <option key={n.id} value={n.id}>{n.libelle} ({n.compte_immobilisation})</option>)}
                              </select>
                            </label>
                            <label className="field">
                              Valeur
                              <input type="number" min={0.01} step="0.01" value={edition.bien.valeur} onChange={(e) => setEdition({ ...edition, bien: { ...edition.bien, valeur: e.target.value } })} />
                            </label>
                          </div>
                          <div className="field-row">
                            <label className="field">
                              Acquisition
                              <input type="date" value={edition.bien.dateAcquisition} onChange={(e) => setEdition({ ...edition, bien: { ...edition.bien, dateAcquisition: e.target.value } })} />
                            </label>
                            <label className="field">
                              Mise en service
                              <input type="date" value={edition.bien.dateMiseEnService} onChange={(e) => setEdition({ ...edition, bien: { ...edition.bien, dateMiseEnService: e.target.value } })} />
                            </label>
                            <label className="field">
                              Durée (années)
                              <input type="number" min={1} value={edition.bien.duree} onChange={(e) => setEdition({ ...edition, bien: { ...edition.bien, duree: e.target.value } })} />
                            </label>
                          </div>
                          <p className="muted">
                            L’amortissement part de la mise en service — de l’acquisition quand elle est vide. Les dotations déjà
                            écrites ne changent pas d’elles-mêmes : elles paraîtront « à réécrire » ci-dessus.
                            {ecrituresDotations.some((x) => x.immobilisation_id === i.id && x.statut !== 'proposee')
                              && ' Une dotation de ce bien est validée : elle ne se réécrira pas, et le brouillon validé divergera du registre.'}
                          </p>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button type="submit" className="btn btn-primary btn-sm" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEdition(null)}>Annuler</button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                  {plansOuverts.has(i.id) && (
                    <tr>
                      <td colSpan={8}>
                        <table aria-label={`Tableau d’amortissement de ${i.libelle}`}>
                          <thead>
                            <tr>
                              <th>Exercice</th>
                              <th style={{ textAlign: 'right' }}>Dotation</th>
                              <th style={{ textAlign: 'right' }}>Amortissement cumulé</th>
                              <th style={{ textAlign: 'right' }}>Valeur nette</th>
                              <th>Écriture</th>
                            </tr>
                          </thead>
                          <tbody>
                            {planAmortissement(i).map((a) => (
                              <tr key={a.annee}>
                                <td>{a.annee}</td>
                                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(a.dotation)}</td>
                                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(a.cumul)}</td>
                                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(a.valeurNette)}</td>
                                <td>{etatDeLExercice(i, a.annee)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ marginTop: 0 }}>Natures et comptes</h3>
          {natureOuverte !== 'natures' && (
            <button className="btn btn-outline btn-sm" onClick={() => setNatureOuverte('natures')}>+ Nature</button>
          )}
        </div>
        <p className="muted">
          La nature d’un bien donne sa durée usuelle et son compte d’immobilisation ; la dotation crédite le compte
          d’amortissement qui s’en déduit (2183 → 28183). Les natures partagées par le cabinet ne se modifient
          qu’en administration ; une nature propre à ce dossier peut porter un autre compte.
        </p>
        {natureOuverte === 'natures' && formulaireNature}
        <div className="table-scroll">
          <table aria-label="Natures">
            <thead><tr><th>Nature</th><th>Durée usuelle</th><th>Comptes</th><th></th></tr></thead>
            <tbody>
              {natures.map((n) => (
                <tr key={n.id}>
                  <td>{n.libelle}</td>
                  <td>{n.duree_annees_defaut} an{n.duree_annees_defaut > 1 ? 's' : ''}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{compteDe(n)}</td>
                  <td className="muted">{n.dossier_id ? 'Propre au dossier' : 'Partagée par le cabinet'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
