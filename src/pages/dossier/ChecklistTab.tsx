import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { analyserEcritures, tvaNettePourPeriode } from '../../lib/ecritures'
import { categoriesSansCompte, categoriesSansPoste, moisEnDoubleSurAbonnement, piecesADateImpossible, piecesDeviseNonConvertie, piecesSansTva, piecesTvaImpossible, piecesValideesSansCategorie } from '../../lib/controles'
import { chargerRelevesIncoherents } from '../../lib/controlesReleves'
import { piecesMontantIntrouvableEnBanque } from '../../lib/appariementBanque'
import { rupturesPisteAudit } from '../../lib/pisteAudit'
import { chargerDoublonsDeTexte, type DoublonDeTexte } from '../../lib/doublonsTexte'
import { anneeDe, formatMoney, moisDe, moisEcoulesCetteAnnee } from '../../lib/format'
import { calculerEvolutionMensuelle, soldesFinDeMois } from '../../lib/tableauPilotage'
import type { ControleReleveBancaire, Categorie, CotisationDeclaree, DeclarationTva, EcritureBrouillon, Immobilisation, InformationsDossier, LigneBancaire, NatureImmobilisation, Piece } from '../../lib/types'
import type { DossierTab } from '../../components/DossierParcours'
import KpiTile from '../../components/widgets/KpiTile'
import Widget from '../../components/widgets/Widget'
import ProgressRing from '../../components/widgets/ProgressRing'
import MonthlyBars from '../../components/widgets/MonthlyBars'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { lireTout } from '../../lib/lectureComplete'

const NB_MOIS_TRESORERIE = 12
const NB_MOIS_COLONNES = 6

const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

interface ItemChecklist {
  id: string
  label: string
  ok: boolean
  detail?: string
  cible?: DossierTab
  // Libellé du bouton d'action quand `cible` est renseigné — jamais le générique "Aller à l'onglet"
  // (voir PointATraiter, même principe).
  action?: string
  onToggle?: () => void
}

// Première page du dossier — ce qu'il reste à obtenir du client, en un coup d'œil (pastille verte /
// rouge) plutôt qu'à reconstituer en fouillant chaque onglet. Volontairement limité à ce qu'on peut
// vérifier de façon fiable sur des données déjà en base (comptage de mois/documents, mots-clés sur une
// nature d'immobilisation que le cabinet nomme lui-même) — jamais une lecture OCR devinée à l'aveugle.
// Les points qui ne se détectent pas de façon fiable (justificatif titres-restaurant reçu...) sont de
// simples cases à cocher manuellement, pas un faux positif automatique.
export default function ChecklistTab({ dossierId, assujettiTva, onNavigate }: { dossierId: string; assujettiTva: boolean; onNavigate: (tab: DossierTab) => void }) {
  // Le nom dit le filtre, et ce n'est pas cosmétique : cet état s'appelait `pieces` alors qu'il ne
  // porte QUE les validées. Un contrôle branché dessus par réflexe devient muet sur tout ce qui est
  // encore à valider — c'est arrivé, sur `moisEnDoubleSurAbonnement`, dont les deux pièces du cas
  // réel sont justement « à valider ». Un piège qu'un nom honnête supprime vaut mieux qu'un piège
  // gardé par un contrôle.
  const [piecesValidees, setPiecesValidees] = useState<Piece[]>([])
  const [piecesAValider, setPiecesAValider] = useState<Piece[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  const [relevesIncoherents, setRelevesIncoherents] = useState<ControleReleveBancaire[]>([])
  const [doublonsTexte, setDoublonsTexte] = useState<DoublonDeTexte[]>([])
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [natures, setNatures] = useState<NatureImmobilisation[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  const [declarationsTva, setDeclarationsTva] = useState<DeclarationTva[]>([])
  const [info, setInfo] = useState<InformationsDossier | null>(null)
  const [loading, setLoading] = useState(true)
  // Non nul quand l'une des grosses collections n'a pas pu être lue en entier : les points ci-dessous
  // portent alors sur une partie du dossier, et leur SILENCE ne prouve plus rien.
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [
      lectureValidees,
      lectureAValider,
      { data: cotisationsData },
      lectureLignes,
      { data: immobilisationsData },
      { data: naturesData },
      { data: categoriesData },
      lectureEcritures,
      { data: declarationsData },
      { data: infoData },
    ] = await Promise.all([
      // Les quatre grosses collections sont lues par tranches, triées sur un ordre TOTAL : le
      // plafond de PostgREST ne se signale pas (voir lib/lectureComplete.ts), et cet écran est
      // précisément celui qui prétend dire ce qui MANQUE. Un contrôle qui ne voit qu'une partie du
      // dossier se tait sur le reste — et se taire est exactement ce qu'on attend de lui quand tout
      // va bien : la panne est indiscernable du succès.
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
      ),
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'a_valider').order('id').range(debut, fin),
      ),
      supabase.from('cotisations_declarees').select('*').eq('dossier_id', dossierId),
      lireTout<LigneBancaire>((debut, fin) =>
        supabase.from('lignes_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      supabase.from('immobilisations').select('*').eq('dossier_id', dossierId),
      supabase.from('natures_immobilisation').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`),
      supabase.from('categories').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`),
      lireTout<EcritureBrouillon>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      supabase.from('declarations_tva').select('*').eq('dossier_id', dossierId),
      supabase.from('informations_dossier').select('*').eq('dossier_id', dossierId).maybeSingle(),
    ])
    // Best-effort, comme dans BanqueTab : l'échec est journalisé, jamais lu comme « aucun écart ».
    const controles = await chargerRelevesIncoherents(dossierId).catch((err) => {
      console.error(err)
      return [] as ControleReleveBancaire[]
    })
    setRelevesIncoherents(controles)
    // Même posture best-effort : journalisé, jamais lu comme « aucun doublon ».
    setDoublonsTexte(await chargerDoublonsDeTexte(dossierId).catch((err) => {
      console.error(err)
      return [] as DoublonDeTexte[]
    }))
    setPiecesValidees(lectureValidees.lignes)
    setPiecesAValider(lectureAValider.lignes)
    setCotisations(cotisationsData ?? [])
    setLignes(lectureLignes.lignes)
    setLectureIncomplete(
      [lectureValidees, lectureAValider, lectureLignes, lectureEcritures].find((l) => !l.complete)?.motif ?? null,
    )
    setImmobilisations(immobilisationsData ?? [])
    setNatures(naturesData ?? [])
    setCategories(categoriesData ?? [])
    setEcritures(lectureEcritures.lignes)
    setDeclarationsTva(declarationsData ?? [])
    setInfo(infoData ?? null)
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function toggleJustificatif(champ: 'justificatif_tickets_restaurant_recu' | 'justificatif_cheques_vacances_recu') {
    if (!info) return
    await supabase.from('informations_dossier').update({ [champ]: !info[champ] }).eq('id', info.id)
    load()
  }

  if (loading) {
    return (
      <div className="bento" aria-busy="true" aria-label="Chargement">
        <div className="skeleton skeleton-kpi span-3" />
        <div className="skeleton skeleton-kpi span-3" />
        <div className="skeleton skeleton-kpi span-3" />
        <div className="skeleton skeleton-kpi span-3" />
        <div className="skeleton skeleton-widget span-7" />
        <div className="skeleton skeleton-widget span-5" />
      </div>
    )
  }

  const anneeCourante = new Date().getFullYear()
  const moisEcoules = moisEcoulesCetteAnnee()

  const moisPresents = new Set(
    lignes.filter((l) => anneeDe(l.date) === anneeCourante).map((l) => moisDe(l.date)),
  )
  const moisManquants = Array.from({ length: moisEcoules }, (_, i) => i + 1).filter((m) => !moisPresents.has(m))

  const cotisationsAnnee = cotisations.filter((c) => anneeDe(c.echeance) === anneeCourante)
  // Toutes les pièces reçues cette année, validées ou non : ce point vérifie que le client a bien
  // envoyé quelque chose, pas que le cabinet a fini de le vérifier (ce serait plutôt "confiance-basse"
  // ci-dessus) — se limiter aux pièces validées faisait dire "aucune pièce déposée" alors que des
  // pièces fraîchement importées, encore à valider, étaient déjà bien là.
  const piecesAnnee = [...piecesValidees, ...piecesAValider].filter((p) => p.date_piece && anneeDe(p.date_piece) === anneeCourante)

  // "Points à traiter" — regroupe en un seul endroit les anomalies déjà détectées séparément dans
  // Pièces (confiance basse), Écritures (comptes manquants, TVA, désynchronisation, déséquilibre) et
  // Clôture (postes manquants), pour ne pas avoir à visiter chaque onglet pour savoir si quelque chose
  // a besoin d'attention. Toujours les mêmes calculs (lib/controles.ts, lib/ecritures.ts) — rien de
  // recalculé différemment ici, juste rassemblé.
  const categorieById = (id: string | null) => categories.find((c) => c.id === id) ?? null
  const immobilisationPieceIds = new Set(immobilisations.map((i) => i.piece_id).filter(Boolean))
  const piecesEligiblesEcritures = piecesValidees.filter(
    (p) => p.montant_ttc != null && !!categorieById(p.categorie_id)?.compte_comptable && !immobilisationPieceIds.has(p.id),
  )
  const { nbSansContrepartie, groupesDesequilibres, piecesDesynchronisees } = analyserEcritures(ecritures, piecesEligiblesEcritures)
  const ruptures = rupturesPisteAudit(ecritures)
  const piecesConfianceBasse = piecesAValider.filter((p) => p.confiance === 'basse')
  const catSansCompte = categoriesSansCompte(categories, piecesValidees)
  const catSansPoste = categoriesSansPoste(categories, piecesValidees)
  const sansTva = piecesSansTva(piecesValidees, assujettiTva)
  const sansCategorie = piecesValideesSansCategorie(piecesValidees)
  // Une pièce datée après son dépôt n'est pas « en attente » : elle est dans un autre exercice, donc
  // absente de Clôture, de la 2035 et de la Balance sans être comptée nulle part comme manquante.
  const dateImpossible = piecesADateImpossible(piecesValidees)
  // Sur TOUTES les pièces, validées ET à valider — et ce n'est pas un détail : `piecesValidees` ne porte ici
  // que les validées. Les deux pièces qui ont fait naître ce contrôle sont toutes deux « à valider »,
  // donc le brancher sur `piecesValidees` seul le rendrait muet sur le cas même qu'il est fait pour voir.
  // Une date fausse se corrige d'autant mieux qu'on la voit AVANT la validation ; après, plus
  // personne ne regarde la pièce.
  const moisEnDouble = moisEnDoubleSurAbonnement([...piecesValidees, ...piecesAValider])
  // Sur les deux piles, validées comme à valider : une TVA arithmétiquement impossible l'est à tout
  // stade, et c'est avant la validation qu'il faut la voir — après, le chiffre est figé dans
  // l'écriture. Sans filtre sur l'assujettissement non plus : un montant impossible signale une
  // lecture ratée du document, et sur un dossier non assujetti c'est le TTC — donc la charge — qui
  // peut être faux (voir lib/controles.ts).
  const tvaImpossible = piecesTvaImpossible([...piecesValidees, ...piecesAValider])
  const deviseNonConvertie = piecesDeviseNonConvertie([...piecesValidees, ...piecesAValider])
  // Même tolérance qu'EcrituresTab (1 € : une CA3 se dépose en euros arrondis).
  const declarationsEnEcart = declarationsTva.filter(
    (d) => Math.abs(d.tva_declaree - tvaNettePourPeriode(ecritures, d.periode_debut, d.periode_fin)) > 1,
  )
  // Le pendant côté Banque de "en attente de rapprochement bancaire" ci-dessous (qui part des
  // écritures) : un mouvement bancaire importé mais jamais rattaché à une pièce, une cotisation, ou
  // marqué personnel/à ignorer — le seul cycle du dossier qui manquait encore à ce tableau de bord.
  const lignesNonRapprochees = lignes.filter((l) => l.statut === 'non_rapprochee')
  // Signal plus grave que « en attente de rapprochement » : un montant qui n'apparaît nulle part dans
  // le relevé importé, à aucune date, révèle soit un relevé incomplet soit un montant faux — voir
  // lib/appariementBanque.ts. Ne porte que sur les pièces jamais rattachées à un mouvement, comme
  // BanqueTab.
  const piecesRapprocheesIds = new Set(lignes.filter((l) => l.piece_id).map((l) => l.piece_id))
  // `piecesValidees` et non `pieces` : ce contrôle ne vise que les pièces VALIDÉES, et son libellé le
  // dit. L'état s'appelait `pieces` quand ce point a été écrit, alors qu'il ne portait déjà que les
  // validées — c'est exactement le nom trompeur que le renommage a supprimé.
  const montantSuspect = piecesMontantIntrouvableEnBanque(piecesValidees.filter((p) => !piecesRapprocheesIds.has(p.id)), lignes)

  // "action" : le libellé du bouton, propre à chaque point plutôt qu'un "Aller à l'onglet" générique
  // répété sur toute la liste — dit ce que l'onglet cible va permettre de faire, pas juste où il est.
  interface PointATraiter { id: string; label: string; action: string; nb: number; cible: DossierTab; severite: 'erreur' | 'attention' }
  const tousLesPointsATraiter: PointATraiter[] = [
    // En tête, et en « erreur » : c'est le seul point de cette liste qui ne se voit nulle part
    // ailleurs. Une pièce validée sans catégorie a l'air traitée — elle ne produit pourtant ni
    // écriture ni ligne de 2035, et aucun autre contrôle ne la voit (voir lib/controles.ts).
    // Avant tout le reste : si le relevé lui-même est incomplet, les mouvements manquants faussent le
    // rapprochement, les totaux et la clôture. Corriger en aval ce qui vient d'une source amputée
    // revient à bâtir sur du sable.
    { id: 'releve-incoherent', label: 'relevé(s) bancaire(s) qui ne bouclent pas — mouvements manquants', action: 'Voir les relevés en écart', nb: relevesIncoherents.length, cible: 'banque', severite: 'erreur' },
    // Un montant qui n'apparaît nulle part dans le relevé, à aucune date : relevé incomplet ou montant
    // faux, deux causes qu'aucune règle interne au document ne peut départager (voir CLAUDE.md,
    // « Fiabilité de l'extraction OCR sur les montants »).
    { id: 'montant-suspect', label: 'pièce(s) validée(s) dont le montant ne correspond à aucun mouvement bancaire', action: 'Voir ces montants', nb: montantSuspect.length, cible: 'banque', severite: 'erreur' },
    { id: 'piste-rompue', label: "écriture(s) sans justificatif ou sans mouvement — piste d'audit rompue", action: 'Voir les écritures concernées', nb: ruptures.length, cible: 'ecritures', severite: 'erreur' },
    { id: 'sans-categorie', label: 'pièce(s) validée(s) sans catégorie — invisibles en compta', action: 'Catégoriser ces pièces', nb: sansCategorie.length, cible: 'pieces', severite: 'erreur' },
    // « Erreur » et non « attention » : ce n'est pas une TVA douteuse, c'est une TVA dont le calcul
    // démontre qu'elle est fausse. Elle part telle quelle en TVA déductible et dans la charge.
    { id: 'tva-impossible', label: 'pièce(s) dont la TVA est arithmétiquement impossible', action: 'Corriger ces montants', nb: tvaImpossible.length, cible: 'pieces', severite: 'erreur' },
    { id: 'date-impossible', label: 'pièce(s) datée(s) après leur dépôt — rangées dans le mauvais exercice', action: 'Corriger ces dates', nb: dateImpossible.length, cible: 'pieces', severite: 'erreur' },
    // « Erreur » comme la date impossible, et pour la même raison : la pièce part dans le mauvais
    // mois, parfois le mauvais exercice. En prime elle bloque un rapprochement bancaire qui était
    // certain (voir lib/controles.ts) — le rapprochement, lui, n'annonce qu'un doute.
    { id: 'mois-en-double', label: "mois d'abonnement en double, avec un mois voisin vide — une pièce mal datée ou en double", action: 'Vérifier ces pièces', nb: moisEnDouble.length, cible: 'pieces', severite: 'erreur' },
    // « Erreur » : si les deux sont validées et catégorisées, la même charge est comptée deux fois —
    // dans la 2035 comme dans la balance. Et l'empreinte du FICHIER ne peut pas le voir (voir
    // lib/doublonsTexte.ts), donc aucun autre écran ne le signale.
    { id: 'doublon-texte', label: 'document(s) déposé(s) plusieurs fois sous des fichiers différents', action: 'Voir les doublons', nb: doublonsTexte.length, cible: 'pieces', severite: 'erreur' },
    // En « erreur » : la pièce n'a AUCUN montant en euros tant que le taux manque, donc elle ne
    // compte nulle part — ni en charge, ni en TVA, ni dans la 2035. Exactement l'effet d'une pièce
    // sans catégorie, par un autre chemin.
    { id: 'devise-non-convertie', label: 'pièce(s) en devise étrangère non converties en euros', action: 'Convertir ces pièces', nb: deviseNonConvertie.length, cible: 'pieces', severite: 'erreur' },
    { id: 'desequilibrees', label: 'écriture(s) déséquilibrée(s)', action: 'Voir les écritures déséquilibrées', nb: groupesDesequilibres.length, cible: 'ecritures', severite: 'erreur' },
    { id: 'desynchronisees', label: 'écriture(s) à régénérer (pièce modifiée depuis)', action: 'Régénérer les écritures concernées', nb: piecesDesynchronisees.length, cible: 'ecritures', severite: 'erreur' },
    { id: 'tva-en-ecart', label: 'déclaration(s) de TVA en écart avec le brouillon', action: "Voir l'écart de TVA", nb: declarationsEnEcart.length, cible: 'ecritures', severite: 'erreur' },
    { id: 'confiance-basse', label: 'pièce(s) à faible confiance d\'extraction, à vérifier', action: 'Vérifier ces pièces', nb: piecesConfianceBasse.length, cible: 'pieces', severite: 'attention' },
    { id: 'comptes-manquants', label: 'catégorie(s) sans compte comptable', action: 'Compléter le compte comptable', nb: catSansCompte.length, cible: 'ecritures', severite: 'attention' },
    { id: 'postes-manquants', label: 'catégorie(s) sans poste 2035', action: 'Compléter le poste 2035', nb: catSansPoste.length, cible: 'cloture', severite: 'attention' },
    { id: 'sans-tva', label: 'pièce(s) validée(s) sans TVA renseignée', action: 'Compléter la TVA', nb: sansTva.length, cible: 'ecritures', severite: 'attention' },
    { id: 'sans-contrepartie', label: 'écriture(s) en attente de rapprochement bancaire', action: 'Voir les écritures à rapprocher', nb: nbSansContrepartie, cible: 'banque', severite: 'attention' },
    { id: 'lignes-non-rapprochees', label: 'ligne(s) bancaire(s) non rapprochée(s)', action: 'Voir les opérations à rapprocher', nb: lignesNonRapprochees.length, cible: 'banque', severite: 'attention' },
  ]
  const pointsATraiter = tousLesPointsATraiter.filter((p) => p.nb > 0)
  // Trois groupes distincts (voir audit ergonomie) plutôt qu'un seul total mélangeant des natures très
  // différentes ("315 à vérifier" ne dit rien d'actionnable si 312 sont des lignes bancaires courantes
  // et 3 des vraies erreurs) : paramétrage (config à finir une fois, ne dépend pas du client), travail
  // courant du cabinet (à traiter au fil de l'eau), documents attendus (dépend du client, voir `items`
  // plus bas). Un déséquilibre ou une désynchronisation reste plus urgent qu'une case de paramétrage,
  // d'où la sévérité conservée à l'intérieur du groupe "Travail à effectuer".
  const IDS_PARAMETRAGE = new Set(['comptes-manquants', 'postes-manquants'])
  const pointsParametrage = pointsATraiter.filter((p) => IDS_PARAMETRAGE.has(p.id))
  const pointsTravail = pointsATraiter.filter((p) => !IDS_PARAMETRAGE.has(p.id))

  const items: ItemChecklist[] = [
    {
      id: 'banque',
      label: `Relevés bancaires ${anneeCourante}`,
      ok: moisManquants.length === 0,
      // moisEcoules à 0 (janvier, aucun mois encore révolu) : rien à réclamer pour l'instant, pas un
      // "0/0" qui se lirait comme un compte à rebours étrange.
      detail: moisEcoules === 0
        ? "Aucun mois encore révolu cette année"
        : moisManquants.length > 0
          ? `Mois manquants : ${moisManquants.map((m) => NOMS_MOIS[m - 1]).join(', ')}`
          : `${moisEcoules}/${moisEcoules} mois reçus`,
      cible: 'banque',
      action: 'Importer le relevé manquant',
    },
    {
      id: 'cotisations',
      label: `Appels de cotisation ${anneeCourante}`,
      ok: cotisationsAnnee.length > 0,
      detail: cotisationsAnnee.length > 0 ? `${cotisationsAnnee.length} échéance(s) enregistrée(s)` : 'Aucune échéance enregistrée pour cette année',
      cible: 'cotisations',
      action: 'Voir les cotisations',
    },
    {
      id: 'factures',
      label: `Factures / pièces ${anneeCourante}`,
      ok: piecesAnnee.length > 0,
      detail: piecesAnnee.length > 0 ? `${piecesAnnee.length} pièce(s) déposée(s)` : 'Aucune pièce déposée pour cette année',
      cible: 'pieces',
      action: 'Voir les pièces',
    },
  ]

  if (!info) {
    items.push({
      id: 'informations',
      label: 'Informations complémentaires du client',
      ok: false,
      detail: 'Véhicule, tickets restaurant, chèques vacances… à renseigner une fois',
      cible: 'informations',
      action: 'Compléter les informations',
    })
  } else {
    if (info.vehicule_type === 'societe') {
      const vehiculeTrouve = immobilisations.some((i) => {
        const nature = natures.find((n) => n.id === i.nature_id)
        return nature && /v[eé]hicule|voiture/i.test(nature.libelle)
      })
      items.push({
        id: 'vehicule',
        label: "Facture d'achat du véhicule de société",
        ok: vehiculeTrouve,
        detail: vehiculeTrouve ? undefined : 'Aucune immobilisation de type véhicule enregistrée',
        cible: 'immobilisations',
        action: 'Enregistrer le véhicule',
      })
    }
    if (info.tickets_restaurant) {
      items.push({
        id: 'tickets',
        label: 'Justificatif titres-restaurant reçu',
        ok: info.justificatif_tickets_restaurant_recu,
        detail: 'À cocher une fois le justificatif obtenu du client',
        onToggle: () => toggleJustificatif('justificatif_tickets_restaurant_recu'),
      })
    }
    if (info.cheques_vacances) {
      items.push({
        id: 'vacances',
        label: 'Justificatif chèques-vacances reçu',
        ok: info.justificatif_cheques_vacances_recu,
        detail: 'À cocher une fois le justificatif obtenu du client',
        onToggle: () => toggleJustificatif('justificatif_cheques_vacances_recu'),
      })
    }
  }

  const nbManquants = items.filter((i) => !i.ok).length
  const nbOk = items.length - nbManquants

  // Tendances de trésorerie (compte 512 du brouillon d'écritures, voir lib/tableauPilotage) —
  // indépendantes de l'exercice sélectionné dans l'en-tête : une pente récente reste utile même en
  // consultant une année passée.
  const soldes = soldesFinDeMois(ecritures, NB_MOIS_TRESORERIE)
  const soldeActuel = soldes.length > 0 ? soldes[soldes.length - 1].solde : null
  const soldePrecedent = soldes.length > 1 ? soldes[soldes.length - 2].solde : null
  const variationSolde = soldeActuel !== null && soldePrecedent !== null ? soldeActuel - soldePrecedent : null
  const evolutionMensuelle = calculerEvolutionMensuelle(ecritures, NB_MOIS_COLONNES)
  const nbErreurs = pointsTravail.filter((p) => p.severite === 'erreur').length

  // Liste de points (Paramétrage / Travail à effectuer) : même présentation pour les deux, un compteur
  // séparé par groupe plutôt qu'un total unique mélangeant leurs natures (voir audit ergonomie). Les
  // lignes sont juste séparées par un filet, la couleur réservée à la pastille de chaque ligne plutôt
  // qu'à la bordure entière du bloc.
  function listePoints(points: PointATraiter[], texteVide: string) {
    if (points.length === 0) return <p className="widget-vide">{texteVide}</p>
    return (
      <div>
        {points.map((p) => (
          <div key={p.id} className="check-ligne">
            <span className={`check-dot ${p.severite === 'erreur' ? 'check-manque' : 'check-attention'}`} />
            <div className="check-ligne-corps">
              <div className="check-ligne-libelle">{p.nb} {p.label}</div>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate(p.cible)}>
              {p.action}
            </button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les pièces, les mouvements ou les écritures"
        motif={lectureIncomplete}
        consequence={
          'Les points ci-dessous portent donc sur une partie du dossier : leur SILENCE ne prouve ' +
          'plus rien. Recharge la page avant de t’y fier.'
        }
      />
      <div className="bento">
        <div className="span-3">
          <KpiTile
            libelle="Pièces à valider"
            valeur={piecesAValider.length}
            statut={piecesAValider.length > 0 ? 'warning' : 'ok'}
            detail={piecesConfianceBasse.length > 0 ? `dont ${piecesConfianceBasse.length} à faible confiance` : 'extraction vérifiée'}
            onClick={() => onNavigate('pieces')}
          />
        </div>
        <div className="span-3">
          <KpiTile
            libelle="Trésorerie (brouillon)"
            valeur={soldeActuel === null ? '—' : formatMoney(soldeActuel)}
            statut={soldeActuel === null ? 'neutral' : soldeActuel < 0 ? 'danger' : 'ok'}
            delta={variationSolde === null ? undefined : { texte: `${variationSolde >= 0 ? '+' : '−'}${formatMoney(Math.abs(variationSolde))} sur le mois`, positif: variationSolde >= 0 }}
            detail={soldeActuel === null ? 'aucune écriture bancaire' : `${soldes.length} mois d'écritures`}
            tendance={soldes.map((s) => s.solde)}
            onClick={() => onNavigate('ecritures')}
          />
        </div>
        <div className="span-3">
          <KpiTile
            libelle={`Relevés ${anneeCourante}`}
            valeur={moisEcoules === 0 ? '—' : <>{moisPresents.size}<small>/ {moisEcoules}</small></>}
            statut={moisEcoules === 0 ? 'neutral' : moisManquants.length > 0 ? 'warning' : 'ok'}
            detail={moisEcoules === 0 ? 'aucun mois encore révolu' : moisManquants.length > 0 ? `${moisManquants.length} mois manquant(s)` : 'tous les mois reçus'}
            onClick={() => onNavigate('banque')}
          />
        </div>
        <div className="span-3">
          <KpiTile
            libelle="Anomalies"
            valeur={pointsTravail.reduce((s, p) => s + p.nb, 0)}
            statut={nbErreurs > 0 ? 'danger' : pointsTravail.length > 0 ? 'warning' : 'ok'}
            detail={nbErreurs > 0 ? `${nbErreurs} type(s) d'erreur bloquante` : pointsTravail.length > 0 ? 'à traiter au fil de l\'eau' : 'rien à signaler'}
          />
        </div>

        <Widget
          className="span-7"
          titre="Travail à effectuer"
          sousTitre="Anomalies détectées dans Pièces, Écritures, Banque et Clôture — rassemblées ici"
        >
          {listePoints(pointsTravail, "Rien à signaler pour l'instant — aucune anomalie détectée.")}
        </Widget>

        {/* Ce qui dépend du client (documents), pas du cabinet — sur une échelle différente des
            anomalies internes, d'où un widget à part plutôt qu'un total combiné. */}
        <Widget
          className="span-5"
          titre="Documents attendus"
          sousTitre="Ce que le dossier attend du client"
          action={<ProgressRing ratio={items.length > 0 ? nbOk / items.length : 1} statut={nbManquants > 0 ? 'warning' : 'ok'} taille={56} epaisseur={6} libelle={`${nbOk} sur ${items.length} reçus`} />}
        >
          <div>
            {items.map((item) => (
              <div key={item.id} className="check-ligne">
                <button
                  type="button"
                  className={`check-dot ${item.ok ? '' : 'check-manque'} ${item.onToggle ? 'check-cliquable' : ''}`}
                  onClick={item.onToggle}
                  disabled={!item.onToggle}
                  title={item.onToggle ? 'Cliquer pour marquer comme reçu/non reçu' : undefined}
                  aria-label={item.ok ? 'Reçu' : 'Manquant'}
                />
                <div className="check-ligne-corps">
                  <div className="check-ligne-libelle">{item.label}</div>
                  {item.detail && <div className="check-ligne-detail">{item.detail}</div>}
                </div>
                {item.cible && !item.ok && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate(item.cible!)}>
                    {item.action ?? 'Voir'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Widget>

        <Widget
          className="span-7"
          titre="Encaissements et décaissements"
          sousTitre={`${NB_MOIS_COLONNES} derniers mois d'écritures bancaires (compte 512 du brouillon)`}
          action={<button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('statistiques')}>Balance</button>}
        >
          {evolutionMensuelle.length === 0 ? (
            <p className="widget-vide">Aucune écriture bancaire générée pour l'instant — ce graphique se remplira au fil des écritures.</p>
          ) : (
            <MonthlyBars mois={evolutionMensuelle} />
          )}
        </Widget>

        <Widget className="span-5" titre="Paramétrage à compléter" sousTitre="Configuration à finir une fois, indépendante du client">
          {listePoints(pointsParametrage, 'Rien à compléter — comptes et postes 2035 sont renseignés.')}
        </Widget>
      </div>
    </>
  )
}
