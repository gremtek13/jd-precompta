import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { messageErreur } from '../../lib/messageErreur'
import type { ModeleComptable } from '../../lib/engagement'
import { ajouterJours, anneeEtMoisEcoules, aujourdHuiAParis, formatDate, formatMoney, premierJourDuMoisCourant } from '../../lib/format'
import { prochainesEcheances } from '../../lib/echeancesFiscales'
import { calculerEvolutionMensuelle, soldesFinDeMois } from '../../lib/tableauPilotage'
import type { PeriodiciteTva, StatutTva } from '../../lib/types'
import type { DossierTab } from '../../components/DossierParcours'
import KpiTile from '../../components/widgets/KpiTile'
import Widget from '../../components/widgets/Widget'
import ProgressRing from '../../components/widgets/ProgressRing'
import MonthlyBars from '../../components/widgets/MonthlyBars'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { reserveCloturesInconnues } from '../../lib/resteAEnvoyer'
import { lireLaChecklist, type LectureDeLaChecklist } from '../../lib/checklistLecture'
import { pointsDeLaChecklist, type DocumentAttendu, type PointATraiter } from '../../lib/pointsDeLaChecklist'
import { useExercicesValides } from '../../context/ExercicesValidesContext'

const NB_MOIS_TRESORERIE = 12
const NB_MOIS_COLONNES = 6

// Un document attendu, et le geste qui le marque reçu quand c'en est un qu'on coche (voir lib/pointsDeLaChecklist.ts).
type ItemChecklist = DocumentAttendu & { onToggle?: () => void }

// Première page du dossier — ce qu'il reste à obtenir du client, en un coup d'œil (pastille verte /
// rouge) plutôt qu'à reconstituer en fouillant chaque onglet. Volontairement limité à ce qu'on peut
// vérifier de façon fiable sur des données déjà en base (comptage de mois/documents, mots-clés sur une
// nature d'immobilisation que le cabinet nomme lui-même) — jamais une lecture OCR devinée à l'aveugle.
// Les points qui ne se détectent pas de façon fiable (justificatif titres-restaurant reçu...) sont de
// simples cases à cocher manuellement, pas un faux positif automatique.
// `modele` : le modèle comptable du dossier (lib/engagement.ts), qui décide de ce que ses écritures
// doivent contenir — lues dans l'autre modèle, elles paraîtraient toutes « à régénérer ».
// `periodiciteTva` : le régime du dossier, qui dit quelles périodes de TVA attendent une déclaration.
// `statutTva` : son statut de TVA (lib/statutTva.ts) — nul, il est à préciser, et c'est un paramétrage à finir.
//
// SES POINTS SE CALCULENT DANS lib/pointsDeLaChecklist.ts, ET SE LISENT PAR lib/checklistLecture.ts : l'onglet de la
// révision (ligne 41, étape R3) range les mêmes points dans ses cycles, et deux copies auraient divergé.
export default function ChecklistTab({ dossierId, assujettiTva, periodiciteTva, statutTva, modele, onNavigate }: {
  dossierId: string
  assujettiTva: boolean
  periodiciteTva: PeriodiciteTva
  statutTva: StatutTva | null
  modele: ModeleComptable
  onNavigate: (tab: DossierTab) => void
}) {
  // Ce que les exercices validés ont figé ne se compare plus : la base refuse de le réécrire, et le dire
  // « à régénérer » laisserait un point en erreur que rien ne lève (lib/validationExercice.ts).
  const { frontiere } = useExercicesValides()
  // Tout ce que les points lisent, avec les drapeaux de ses lectures partielles (lib/checklistLecture.ts). Nul avant
  // la première lecture : rien ne s'affirme d'une liste pas encore revenue.
  const [lecture, setLecture] = useState<LectureDeLaChecklist | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setLecture(await lireLaChecklist(dossierId))
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function toggleJustificatif(champ: 'justificatif_tickets_restaurant_recu' | 'justificatif_cheques_vacances_recu') {
    const info = lecture?.info
    if (!info) return
    const { error: erreurCoche } = await supabase.from('informations_dossier').update({ [champ]: !info[champ] }).eq('id', info.id)
    // Refusée, la coche se DIT : la relecture la remet comme avant, et sans un mot on croirait le justificatif noté.
    if (erreurCoche) window.alert(`Ce justificatif n’a pas pu être marqué : ${messageErreur(erreurCoche, 'refus de la base')}.`)
    load()
  }

  if (loading || !lecture) {
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

  // Même instant pour les deux (voir anneeEtMoisEcoules) : « N mois écoulés » ne désigne des mois que
  // rapporté à SON année, et ces trois écrans doivent dire la même chose au même moment.
  const { annee: anneeCourante, moisEcoules } = anneeEtMoisEcoules()

  // LE CALENDRIER DE LA CFE, DE LA CVAE ET DE LA LIASSE (lib/echeancesFiscales.ts), les douze prochains mois, lu à Paris
  // comme l'administration date ses échéances. Chaque échéance DIT à qui elle s'adresse : la Checklist ne sait ni la CFE
  // de l'an dernier, ni la CVAE, ni si un établissement a été créé, et elle ne les devine pas. La 2035 n'est pas la
  // liasse d'un dossier tenu en engagement : son échéance n'y figure pas, celles de la CFE et de la CVAE si.
  const aujourdHuiFiscal = aujourdHuiAParis()
  const calendrierFiscal = prochainesEcheances(aujourdHuiFiscal)
    .filter((e) => modele.mode !== 'engagement' || e.impot !== 'Liasse')
  const imminente = (date: string) => date <= ajouterJours(aujourdHuiFiscal, 30)

  const { lectureIncomplete, ouvertureIncomplete, ouverture, clotureInconnue, infoInconnue, ecritures, piecesAValider } = lecture
  // Les relevés incohérents et les doublons de contenu sont BEST-EFFORT ici : illisibles, ils se lisent comme vides —
  // l'échec est journalisé par la lecture —, comme avant que leurs lectures sortent de cet écran.
  const {
    pointsParametrage, pointsTravail, documentsAttendus, moisManquants, moisRecus, piecesConfianceBasse,
  } = pointsDeLaChecklist(
    { ...lecture, relevesIncoherents: lecture.relevesIncoherents ?? [], doublonsTexte: lecture.doublonsTexte ?? [] },
    { assujettiTva, periodiciteTva, statutTva, modele, frontiere, anneeCourante, moisEcoules, premierJourDuMois: premierJourDuMoisCourant() },
  )
  const items: ItemChecklist[] = documentsAttendus.map((item) => {
    const coche = item.coche
    return coche ? { ...item, onToggle: () => toggleJustificatif(coche) } : item
  })

  const nbManquants = items.filter((i) => !i.ok).length
  const nbOk = items.length - nbManquants

  // Tendances de trésorerie (compte 512 du brouillon d'écritures, voir lib/tableauPilotage) —
  // indépendantes de l'exercice sélectionné dans l'en-tête : une pente récente reste utile même en
  // consultant une année passée.
  const soldes = soldesFinDeMois(ecritures, NB_MOIS_TRESORERIE, ouverture)
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
              <div className="check-ligne-libelle">{p.sansNombre ? p.label : `${p.nb} ${p.label}`}</div>
              {p.detail && <div className="check-ligne-detail">{p.detail}</div>}
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
        quoi="Les données du dossier"
        motif={lectureIncomplete}
        consequence={
          'Les points ci-dessous portent donc sur une partie du dossier : leur SILENCE ne prouve ' +
          'plus rien. Recharge la page avant de t’y fier.'
        }
      />
      <BandeauLecturePartielle
        quoi="Les à-nouveaux du dossier"
        accord="lus"
        motif={ouvertureIncomplete}
        consequence={
          'La tuile Trésorerie ne peut donc pas partir du solde repris : elle n’affiche aucun montant, ' +
          'plutôt qu’un solde faux — et un rouge faux. Et les points qui en dépendent se taisent : les ' +
          'dotations aux amortissements, les forfaits kilométriques, et l’écriture de la facture d’un bien — ' +
          'c’est l’ouverture qui dit ce qui est déjà dans la balance reprise. Recharge la page.'
        }
      />
      {reserveCloturesInconnues(clotureInconnue, anneeCourante, { technique: true }) && (
        <p className="error-text">{reserveCloturesInconnues(clotureInconnue, anneeCourante, { technique: true })}</p>
      )}
      {infoInconnue && (
        <p className="error-text">
          {infoInconnue} Les points qui en dépendent sont donc absents de la liste ci-dessous —
          véhicule, tickets restaurant, chèques vacances : ni réclamés, ni déclarés à jour.
        </p>
      )}
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
          {/* Une ouverture illisible ne laisse ni montant ni couleur : un dossier repris compté depuis
              zéro passerait au rouge sur un compte qui porte de l'argent. */}
          <KpiTile
            libelle="Trésorerie (brouillon)"
            valeur={ouvertureIncomplete !== null || soldeActuel === null ? '—' : formatMoney(soldeActuel)}
            statut={ouvertureIncomplete !== null || soldeActuel === null ? 'neutral' : soldeActuel < 0 ? 'danger' : 'ok'}
            delta={ouvertureIncomplete !== null || variationSolde === null ? undefined : { texte: `${variationSolde >= 0 ? '+' : '−'}${formatMoney(Math.abs(variationSolde))} sur le mois`, positif: variationSolde >= 0 }}
            detail={
              ouvertureIncomplete !== null ? 'ouverture illisible'
                : soldeActuel === null ? 'aucune écriture bancaire'
                : ouverture ? `depuis l’ouverture du ${formatDate(ouverture.date)}`
                : `${soldes.length} mois d'écritures`
            }
            tendance={ouvertureIncomplete !== null ? [] : soldes.map((s) => s.solde)}
            onClick={() => onNavigate('ecritures')}
          />
        </div>
        <div className="span-3">
          <KpiTile
            libelle={`Relevés ${anneeCourante}`}
            valeur={moisEcoules === 0 ? '—' : <>{moisRecus}<small>/ {moisEcoules}</small></>}
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
          {listePoints(pointsParametrage, 'Rien à compléter — statut de TVA, comptes et postes 2035 sont renseignés.')}
        </Widget>

        {/* Des dates, pas des anomalies : aucun bouton, et la pastille ne dit que l'imminence — trente jours ou moins. */}
        <Widget
          className="span-12"
          titre="Échéances fiscales"
          sousTitre="CFE, CVAE et liasse, les douze prochains mois — chacune dit à qui elle s’adresse"
        >
          <div>
            {calendrierFiscal.map((e) => (
              <div key={e.id} className="check-ligne">
                <span className={`check-dot ${imminente(e.date) ? 'check-attention' : ''}`} aria-label={imminente(e.date) ? 'Dans les trente jours' : 'À venir'} />
                <div className="check-ligne-corps">
                  <div className="check-ligne-libelle">{formatDate(e.date)} — {e.libelle}</div>
                  <div className="check-ligne-detail">{e.condition}</div>
                </div>
              </div>
            ))}
          </div>
        </Widget>
      </div>
    </>
  )
}
