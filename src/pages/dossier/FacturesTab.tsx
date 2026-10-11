import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import type { ArticleExoneration, FactureEmise, StatutTva, TransmissionFacture } from '../../lib/types'
import type {
  DeclarationLue, EncaissementPourContrePassation, EvenementSuperpdpLu, LigneDeFacture, PartLue,
} from '../../lib/encaissementsFactures'
import { pastilleDeclaration, pastilleEncaissement } from '../../lib/encaissementsAffichage'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import FactureFormModal from './FactureFormModal'
import FactureAvoirModal from './FactureAvoirModal'
import FactureApercu from './FactureApercu'
import TransmissionFactureModal from './TransmissionFactureModal'
import EncaissementsFactureModal from './EncaissementsFactureModal'
import { badgeClasseStatutSuperpdp, libelleStatutSuperpdp } from '../../lib/superpdpStatuts'
import {
  ETATS_TRANSMISSION, annuleeSurSaPlateforme, libelleCourtCanal, transmissionCourante,
} from '../../lib/transmissionsFactures'
import { lireConnexionPlateforme, type ConnexionPlateformeVue } from '../../lib/receptionPlateforme'
import {
  CONSEQUENCE_ANNULATION, auteurDuStatut, classeStatutLu, libelleStatutLu, statutDeLaPastille,
  type StatutLu,
} from '../../lib/statutsLus'
import { releverEtNommer, type ResultatReleve } from '../../lib/releveStatuts'
import BilanReleveStatuts from './BilanReleveStatuts'
import ConnexionsClient from './ConnexionsClient'
import EnvoyerEmailModal from '../../components/EnvoyerEmailModal'
import { lireLesVentesDuDossier } from '../../lib/ventesLecture'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { messageErreur } from '../../lib/messageErreur'
import { dejaCredite, SUPPRESSION_BROUILLON_EXPORTEE, supprimerBrouillon } from '../../lib/factures'
import { pourLEspace, pourLEspaceSiTexte } from '../../lib/espaceVentes'
import {
  ACCES_EN_COURS, ACCES_SANS_OBJET, AIDE_DU_FILTRE, LIBELLE_DU_FILTRE, emiseParLeClient, etatDuFiltre, pastilleParLeClient,
  type AccesDuDossier,
} from '../../lib/auteursVentes'
import { lireLesAccesDuDossier } from '../../lib/auteursVentesLecture'

// QUI REGARDE (espace client, étape P4a) : le cabinet, depuis l'onglet Factures d'un dossier, qui peut aussi enregistrer
// l'adresse du dossier depuis une facture ; ou le client qui porte la case « Ventes », depuis « Mes ventes › Factures »,
// avec ou sans « Banque » sur la société affichée. Les mêmes gestes, par les mêmes fonctions (P2 et P3 les lui ouvrent) ;
// ceux du cabinet seul retirés, les mots de son espace (lib/espaceVentes.ts). Une propriété OBLIGATOIRE, sans valeur par
// défaut : un écran qui oublierait de dire qui regarde ne compile pas.
type QuiRegarde =
  | { espace: 'cabinet'; onAdresseUpdated: (adresse: string) => void }
  | { espace: 'client'; banque: boolean }

type Props = QuiRegarde & {
  dossierId: string
  dossierNom: string
  dossierSiret: string | null
  dossierAdresse: string | null
  // Le statut de TVA du dossier (lib/statutTva.ts) : la mention proposée sur une facture et les taux admis.
  statutTva: StatutTva | null
  articleExoneration: ArticleExoneration | null
  // Un dossier en franchise ou exonéré qui a un numéro de TVA (la case de l'onglet TVA) : ses factures sans TVA partent.
  numeroTvaAttribue: boolean
  // L'option du dossier pour le paiement de la TVA d'après les débits, que la validation fige sur la facture.
  tvaSurDebits: boolean
}

// Facturation du dossier — émet soi-même des factures conformes, en complément de la réception déjà
// en place (Super PDP, voir SuperPdpModal). Une facture validée peut être transmise par une plateforme
// agréée — celle du client ou Super PDP (voir TransmissionFactureModal) — ou, comme avant, simplement
// imprimée/exportée en PDF pour être envoyée manuellement : la transmission électronique n'est jamais
// obligatoire ici (un client particulier, une plateforme pas encore reliée).
export default function FacturesTab(props: Props) {
  const { dossierId, dossierNom, dossierSiret, dossierAdresse, statutTva, articleExoneration, numeroTvaAttribue, tvaSurDebits, espace } = props
  const dire = (texte: string) => pourLEspace(espace, texte)
  const [factures, setFactures] = useState<FactureEmise[]>([])
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')
  const [recherche, setRecherche] = useState('')
  const [editing, setEditing] = useState<FactureEmise | 'new' | null>(null)
  const [apercu, setApercu] = useState<FactureEmise | null>(null)
  const [avoirDe, setAvoirDe] = useState<FactureEmise | null>(null)
  // L'IDENTIFIANT de la facture qu'on transmet, et non la facture : la fenêtre doit voir la ligne relue après un envoi
  // (le numéro qu'a rendu Super PDP), pas celle du clic.
  const [transmissionDe, setTransmissionDe] = useState<string | null>(null)
  // Les transmissions du dossier, pour dire où en est chaque facture ; la fenêtre relit celles de la sienne.
  const [transmissions, setTransmissions] = useState<TransmissionFacture[]>([])
  const [transmissionsIncompletes, setTransmissionsIncompletes] = useState<string | null>(null)
  const [emailDe, setEmailDe] = useState<FactureEmise | null>(null)
  // Les encaissements des factures (ligne 28.5, étape d3) : de quoi dire, sur chaque facture validée, ce qui en est
  // encaissé. L'IDENTIFIANT de la facture ouverte, comme pour la transmission : la fenêtre relit tout elle-même.
  const [encaissementsDe, setEncaissementsDe] = useState<string | null>(null)
  const [lignesFactures, setLignesFactures] = useState<LigneDeFacture[]>([])
  const [encaissements, setEncaissements] = useState<EncaissementPourContrePassation[]>([])
  const [partsEncaissements, setPartsEncaissements] = useState<PartLue[]>([])
  const [encaissementsIncomplets, setEncaissementsIncomplets] = useState<string | null>(null)
  // Leurs déclarations, et l'historique de Super PDP qui dit une facture refusée (ligne 28.5, étape d4) : de quoi dire,
  // sur chaque facture dont le statut « Encaissée » est dû, ce qui reste à déclarer.
  const [declarations, setDeclarations] = useState<DeclarationLue[]>([])
  const [evenementsSuperpdp, setEvenementsSuperpdp] = useState<EvenementSuperpdpLu[]>([])
  const [declarationsIncompletes, setDeclarationsIncompletes] = useState<string | null>(null)
  // Les statuts du cycle de vie lus sur la plateforme du client (ligne 28.5, étape d7) : le dernier sur chaque facture,
  // et un refus ou un rejet qui éteint « À déclarer ». Le cabinet seul les voit.
  const [statutsLus, setStatutsLus] = useState<StatutLu[]>([])
  const [statutsIncomplets, setStatutsIncomplets] = useState<string | null>(null)
  // La connexion à la plateforme du client, telle que la base la garde (aucun appel à la plateforme) : `undefined` tant
  // qu'elle n'est pas lue ou quand sa lecture a échoué, `null` quand le dossier n'en a pas. Le bouton qui relève les
  // statuts n'existe que si elle existe.
  const [connexion, setConnexion] = useState<ConnexionPlateformeVue | null | undefined>(undefined)
  const [connexionErreur, setConnexionErreur] = useState<string | null>(null)
  const [resultatReleve, setResultatReleve] = useState<ResultatReleve | null>(null)
  const [erreurReleve, setErreurReleve] = useState<string | null>(null)
  const [releveOccupe, setReleveOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  // QUI EST LE CLIENT (étape P4c), au cabinet seul : les accès du dossier, lus UNE fois ici et passés aux fenêtres. Gardés
  // AVEC le dossier pour lequel ils ont été lus : changer de dossier repart en lecture, et une réponse arrivée après ne
  // reconnaît le client de personne d'autre. Dans l'espace du client, rien n'est lu et rien n'est dit « par le client ».
  const [accesLus, setAccesLus] = useState<{ dossierId: string; acces: AccesDuDossier } | null>(null)
  const acces: AccesDuDossier = espace === 'client'
    ? ACCES_SANS_OBJET
    : accesLus?.dossierId === dossierId ? accesLus.acces : ACCES_EN_COURS
  // La case « Émises par le client » : une préférence d'AFFICHAGE, qui ne vaut que sur des accès lus en entier.
  const [filtreClient, setFiltreClient] = useState(false)
  const filtre = etatDuFiltre(acces)

  async function load() {
    setLoading(true)
    // Les lectures de l'onglet, que l'accueil du client compte aussi (lib/ventesLecture.ts) : la suite LÉGALE des
    // factures, leurs transmissions, leurs encaissements, leurs déclarations, l'historique de Super PDP et les statuts lus.
    const lu = await lireLesVentesDuDossier(dossierId)
    setFactures(lu.factures)
    setLectureIncomplete(lu.facturesIncompletes)
    setTransmissions(lu.transmissions)
    setTransmissionsIncompletes(lu.transmissionsIncompletes)
    setLignesFactures(lu.lignes)
    setEncaissements(lu.encaissements)
    setPartsEncaissements(lu.parts)
    setEncaissementsIncomplets(lu.encaissementsIncomplets)
    setDeclarations(lu.declarations)
    setEvenementsSuperpdp(lu.evenementsSuperpdp)
    setDeclarationsIncompletes(lu.declarationsIncompletes)
    setStatutsLus(lu.statutsLus)
    setStatutsIncomplets(lu.statutsIncomplets)
    setLoading(false)
  }
  useEffect(() => { load() }, [dossierId])

  async function lireConnexion() {
    const r = await lireConnexionPlateforme(dossierId)
    setConnexion(r.erreur === null ? r.donnees.connexion : undefined)
    setConnexionErreur(r.erreur)
  }
  // La connexion se lit en base par `plateforme-agreee` (action « statut ») : rien ne part chez la plateforme. Une
  // réponse arrivée après un changement de dossier ne s'écrit pas.
  useEffect(() => {
    let annule = false
    lireConnexionPlateforme(dossierId).then((r) => {
      if (annule) return
      setConnexion(r.erreur === null ? r.donnees.connexion : undefined)
      setConnexionErreur(r.erreur)
    })
    return () => { annule = true }
  }, [dossierId])

  // Les accès du dossier, lus à l'ouverture (la base, jamais une plateforme) : une réponse arrivée après un changement de
  // dossier ne s'écrit pas.
  useEffect(() => {
    if (espace !== 'cabinet') return
    let annule = false
    lireLesAccesDuDossier(dossierId).then((lu) => {
      if (!annule) setAccesLus({ dossierId, acces: lu })
    })
    return () => { annule = true }
  }, [dossierId, espace])

  // LE RELEVÉ DES STATUTS, SUR UN CLIC : la fonction lit la plateforme du client, garde ce qui se rattache à une facture
  // du dossier et rend son bilan. Un verrou posé avant le `try`, relâché dans le `finally` APRÈS la relecture des
  // factures, des statuts et de la connexion : un second clic pendant qu'elle court relirait la plateforme pour rien, et
  // la pastille dirait encore ce qu'elle disait avant.
  const releveEnCours = useRef(false)
  async function relever() {
    if (releveEnCours.current) return
    releveEnCours.current = true
    setReleveOccupe(true)
    setErreurReleve(null)
    setResultatReleve(null)
    try {
      const r = await releverEtNommer(dossierId, false)
      if (r.erreur !== null) setErreurReleve(r.erreur)
      else setResultatReleve(r.resultat)
      await Promise.all([load(), lireConnexion()])
    } catch (e) {
      setErreurReleve(messageErreur(e, 'Les statuts de la plateforme n’ont pas pu être lus.'))
    } finally {
      releveEnCours.current = false
      setReleveOccupe(false)
    }
  }

  // Le jour à Paris, lu au rendu : une déclaration en retard l'est au jour de la base, pas à celui du chargement.
  const aujourdHui = aujourdHuiAParis()
  const anneesDisponibles = [...new Set(factures.map((f) => anneeDe(f.date_emission)))].sort((a, b) => b - a)
  // Le filtre « Émises par le client » ne touche que l'AFFICHAGE : les pastilles d'encaissement et de déclaration, la liste
  // des avoirs déjà crédités et les fenêtres lisent `factures` en entier. Il n'agit que si les accès sont lus en entier.
  const filtreActif = filtreClient && filtre.disponible
  const avantRecherche = factures
    .filter((f) => anneeFilter === 'toutes' || anneeDe(f.date_emission) === anneeFilter)
    .filter((f) => !filtreActif || emiseParLeClient(acces, f))
  const filtered = avantRecherche.filter((f) =>
    correspondALaRecherche([f.numero, f.tiers_nom, f.statut, f.date_emission, formatDate(f.date_emission), f.montant_ttc], recherche),
  )

  // Le résultat de la suppression est LU : le `load()` qui suit fait bien réapparaître un brouillon
  // refusé, mais sans un mot, sur un geste que l'opérateur vient de CONFIRMER — le réflexe est alors
  // de reconfirmer, et d'obtenir le même silence (le défaut de `SuperPdpModal.retirer`, corrigé de
  // même sur `SupplementsTab` et `AccesTab`).
  // Par la base, puisque sa fonction y est depuis le 10/10/2026 (`SUPPRESSION_BROUILLON_EXPORTEE`, espace client, étape
  // P2) : le chemin du client, qui rend ce qu'il a supprimé ; directement sous la policy du cabinet si le drapeau
  // redescendait avec elle (le chemin d'avant, gardé et éprouvé tant que son code existe). Un verrou posé
  // avant le `try`, relâché dans le `finally` après la relecture : deux clics du même rendu ne demandent qu'une
  // suppression, et le second ne dit pas « introuvable » d'un brouillon que le premier vient de supprimer.
  const suppressionEnCours = useRef(false)
  async function supprimer(f: FactureEmise) {
    if (suppressionEnCours.current) return
    if (!window.confirm(`Supprimer le brouillon de facture pour "${f.tiers_nom}" ? Cette action est irréversible.`)) return
    suppressionEnCours.current = true
    setErreur(null)
    try {
      if (SUPPRESSION_BROUILLON_EXPORTEE) {
        await supprimerBrouillon(dossierId, f.id)
      } else {
        const { error: suppressionError } = await supabase.from('factures_emises').delete().eq('id', f.id)
        if (suppressionError) setErreur(messageErreur(suppressionError, 'Le brouillon n’a pas pu être supprimé.'))
      }
    } catch (e) {
      setErreur(messageErreur(e, 'Le brouillon n’a pas pu être supprimé.'))
    } finally {
      await load()
      suppressionEnCours.current = false
    }
  }

  // La facture qu'on transmet, telle que la liste l'a relue en dernier.
  const transmise = transmissionDe ? factures.find((f) => f.id === transmissionDe) ?? null : null
  const encaissee = encaissementsDe ? factures.find((f) => f.id === encaissementsDe) ?? null : null

  function ouvrir(f: FactureEmise) {
    if (f.statut === 'validee') setApercu(f)
    else setEditing(f)
  }

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les factures du dossier"
        motif={lectureIncomplete}
        consequence={
          'La suite des numéros est LÉGALE : une liste tronquée fait croire à un trou là où il n’y en ' +
          'a pas. Recharge la page avant d’en conclure quoi que ce soit.'
        }
      />
      <BandeauLecturePartielle
        quoi="Les transmissions des factures"
        motif={transmissionsIncompletes}
        consequence={
          'Une facture peut paraître jamais transmise alors qu’elle l’a été, et aucune ne dit ce qui reste à déclarer de ses '
          + 'encaissements. La fenêtre « Transmettre » relit celles de sa facture avant de proposer un envoi.'
        }
      />
      <BandeauLecturePartielle
        quoi="Les encaissements des factures"
        accord="lus"
        motif={encaissementsIncomplets}
        consequence={
          'Aucune facture ne dit donc ce qui en est encaissé : une liste tronquée ferait dire « À encaisser » d’une facture '
          + 'payée. La fenêtre « Encaissements » relit ceux de sa facture.'
        }
      />
      <BandeauLecturePartielle
        quoi="Les déclarations des encaissements"
        accord="lues"
        motif={declarationsIncompletes}
        consequence={
          'Aucune facture ne dit donc ce qui reste à déclarer : une liste tronquée ferait dire « À déclarer » d’un encaissement '
          + 'déjà déclaré. La fenêtre « Encaissements » relit celles de sa facture.'
        }
      />
      <BandeauLecturePartielle
        quoi={dire('Les statuts lus sur la plateforme du client')}
        accord="lus"
        motif={statutsIncomplets}
        consequence={
          'Aucune facture ne dit donc son dernier statut ni ce qui reste à déclarer : un refus de l’acheteur qu’on ne verrait '
          + 'pas laisserait dire « À déclarer » d’une facture refusée. La fenêtre « Encaissements » relit ceux de sa facture.'
        }
      />
      {/* Le statut de TVA se précise au cabinet : le client ne peut que l'attendre, et le sait avant de rédiger. */}
      {espace === 'client' && statutTva == null && (
        <p className="alerte-tva">Ton cabinet doit d’abord préciser ton statut de TVA : tes factures ne peuvent pas partir.</p>
      )}
      <p className="muted" style={{ marginTop: -8, marginBottom: 4 }}>
        Une facture validée reçoit un numéro définitif et n'est plus modifiable — corrige une erreur
        par une facture d'avoir plutôt qu'en la rouvrant.
      </p>
      <details className="muted" style={{ marginBottom: 20 }}>
        <summary style={{ cursor: 'pointer' }}>En savoir plus</summary>
        <p style={{ marginTop: 6, marginBottom: 0 }}>
          Le bouton "Avoir" sur une ligne crée un avoir avec sa propre numérotation (série "A",
          indépendante des factures), qui référence toujours la facture corrigée. Une fois validée,
          une facture peut être transmise par une plateforme agréée —{' '}
          {espace === 'client' ? 'la tienne, que tu relies dans « Tes plateformes »,' : 'celle du client, reliée dans l\'onglet Justificatifs,'}
          {' '}ou Super PDP — ou envoyée par e-mail ; imprimer/enregistrer en PDF
          reste possible si tu préfères l'envoyer toi-même.
        </p>
      </details>

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un numéro, un client, un montant…"
          affiches={filtered.length}
          total={avantRecherche.length}
        />
      </div>

      {/* Le cabinet seul : « Émises par le client » (étape P4c). Grisée avec sa raison tant que les accès ne sont pas lus en
          entier ; l'aide dit ce que la case reconnaît, et ce qu'elle ne reconnaît plus (un accès retiré). */}
      {espace === 'cabinet' && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox" checked={filtreActif} disabled={!filtre.disponible} aria-describedby="aide-filtre-client"
              onChange={(e) => setFiltreClient(e.target.checked)}
            />
            {LIBELLE_DU_FILTRE}
          </label>
          <p id="aide-filtre-client" className="muted" style={{ margin: '4px 0 0', fontSize: '0.82rem' }}>
            {filtre.disponible ? AIDE_DU_FILTRE : filtre.raison}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>+ Nouvelle facture</button>
      </div>

      {/* Le client relie lui-même sa plateforme agréée et Super PDP (étape P4b, sous EC-Q4) : la section dit leur état, une
          lecture ratée comprise, et ouvre leurs fenêtres en mode client. Rien ne s'y dit avant la lecture. */}
      {espace === 'client' && (
        <ConnexionsClient
          dossierId={dossierId} connexion={connexion} connexionErreur={connexionErreur} relireConnexion={lireConnexion}
        />
      )}

      {/* La plateforme du client et le cycle de vie de ses factures émises : relevé sur un clic, jamais à l'ouverture. */}
      {connexion && (
        <div className="plateforme-statuts">
          <p>
            {dire('Plateforme du client')} : {connexion.nom} <span className="muted">({connexion.hote})</span> —{' '}
            {connexion.cycle_vie_lu_le
              ? `statuts des factures émises lus le ${formatDate(connexion.cycle_vie_lu_le)}.`
              : 'les statuts des factures émises n’ont pas encore été lus.'}
          </p>
          <button type="button" className="btn btn-outline btn-sm" disabled={releveOccupe} onClick={relever}>
            {releveOccupe ? 'Lecture des statuts…' : 'Lire les statuts de la plateforme'}
          </button>
        </div>
      )}
      {/* Une connexion illisible : le client le lit dans « Tes plateformes », au-dessus. */}
      {espace === 'cabinet' && connexionErreur && (
        <p className="muted">
          Plateforme du client : {connexionErreur} Les statuts de ses factures ne se relèvent pas d’ici tant qu’elle n’est pas lue.
        </p>
      )}
      {erreurReleve && <p className="error-text">{dire(erreurReleve)}</p>}
      {resultatReleve && <BilanReleveStatuts resultat={resultatReleve} espace={espace} />}

      {erreur && <p className="error-text">{pourLEspaceSiTexte(espace, erreur)}</p>}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          // « Aucune facture » seulement sur une lecture COMPLÈTE : une lecture refusée rend aussi une
          // liste vide, et l'affirmation deviendrait fausse au lieu d'une panne dite — sur la suite de
          // numéros qu'un cabinet doit pouvoir présenter sans trou (même règle que PacksTab).
          <div className="empty-state">
            {recherche.trim()
              ? `Aucune facture ne correspond à « ${recherche.trim()} ».`
              : lectureIncomplete ? 'La liste des factures n’a pas pu être lue.'
                : filtreActif ? 'Aucune facture ni aucun avoir n’a été validé par le client.' : 'Aucune facture.'}
          </div>
        ) : (
          // REPLIÉE EN FICHES SOUS 860 PIXELS D'ENVELOPPE (08/10/2026). Six colonnes — dont une de quatre boutons — ne
          // tiennent pas dans le panneau central quand le volet de droite est ouvert (le cas par défaut sur ordinateur) :
          // la colonne des boutons passait derrière un défilement latéral, et la pastille d'état devenait un disque de
          // quatre lignes. Chaque facture devient une fiche dont toutes les actions sont à portée (voir `.tableau-adaptable`
          // dans index.css). `.card` reste l'enveloppe qui défile et qui arrondit l'en-tête : l'enveloppe adaptable est DANS
          // la carte, et c'est `table-empilable-en-carte` qui rend aux fiches le jeu que la carte, sans marge, ne leur donne pas.
          <div className="tableau-adaptable">
            <table className="table-empilable table-empilable-en-carte">
              <thead>
                <tr><th>Numéro</th><th>Date</th><th>Client</th><th>Montant TTC</th><th>Statut</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  const origine = f.facture_origine_id ? factures.find((o) => o.id === f.facture_origine_id) : null
                  return (
                    <tr key={f.id} className="clickable" onClick={() => ouvrir(f)}>
                      {/* Une `div` par cellule qui porte plusieurs éléments : repliée, la cellule est une rangée flex, et
                          chaque enfant direct y serait une pièce à part — le numéro, la pastille « Avoir » et la facture
                          corrigée écartés au bout de la rangée. */}
                      <td data-libelle="Numéro">
                        <div>
                          {f.numero ?? '—'}
                          {f.type === 'avoir' && (
                            <>
                              {' '}<span className="badge badge-neutral">Avoir</span>
                              <div className="muted" style={{ fontSize: '0.78rem' }}>→ {origine?.numero ?? f.facture_origine_id?.slice(0, 8)}</div>
                            </>
                          )}
                        </div>
                      </td>
                      <td data-libelle="Date">{formatDate(f.date_emission)}</td>
                      <td data-libelle="Client">{f.tiers_nom}</td>
                      <td data-libelle="Montant TTC">{formatMoney(f.montant_ttc)}</td>
                      <td data-libelle="Statut">
                        <div className="pastilles-empilees">
                          {f.statut === 'validee'
                            ? <span className="badge badge-ok">Validée</span>
                            : <span className="badge badge-warning">Brouillon</span>}
                          {/* « Par le client » : discrète, au cabinet seul, et seulement sur des accès lus en entier. */}
                          {(() => {
                            const pastille = pastilleParLeClient(acces, f)
                            return pastille ? <span className="badge badge-neutral badge-une-ligne" title={pastille.titre}>{pastille.libelle}</span> : null
                          })()}
                          {f.statut === 'validee' && (() => {
                            const courante = transmissionCourante(transmissions, f.id)
                            // Partie par Super PDP, la facture a un cycle de vie que Super PDP rend (reçue, refusée par
                            // l'acheteur, encaissée…) : il en dit plus que l'état de sa transmission.
                            if (courante?.canal === 'superpdp' && f.superpdp_dernier_statut) {
                              return (
                                <span className={`badge badge-une-ligne ${badgeClasseStatutSuperpdp(f.superpdp_dernier_statut)}`}>
                                  Super PDP · {libelleStatutSuperpdp(f.superpdp_dernier_statut)}
                                </span>
                              )
                            }
                            if (courante) {
                              return (
                                <span className={`badge badge-une-ligne ${ETATS_TRANSMISSION[courante.etat].badge}`}>
                                  {dire(libelleCourtCanal(courante))} · {ETATS_TRANSMISSION[courante.etat].libelle}
                                </span>
                              )
                            }
                            // Partie par Super PDP avant que chaque envoi laisse sa transmission.
                            return f.superpdp_invoice_id ? (
                              <span className={`badge badge-une-ligne ${badgeClasseStatutSuperpdp(f.superpdp_dernier_statut)}`}>
                                Super PDP · {f.superpdp_dernier_statut ? libelleStatutSuperpdp(f.superpdp_dernier_statut) : '…'}
                              </span>
                            ) : null
                          })()}
                          {/* Le cycle de vie lu sur la plateforme du client : le dernier statut, ou le refus s'il y en a un.
                              Rien sur une lecture incomplète : un refus manquant laisserait lire un statut trompeur. */}
                          {f.statut === 'validee' && statutsIncomplets == null && (() => {
                            const s = statutDeLaPastille(statutsLus, f.id)
                            if (!s) return null
                            const auteur = auteurDuStatut(s.createur_role)
                            return (
                              <span
                                className={`badge badge-une-ligne ${classeStatutLu(s.code)}`}
                                title={`Lu sur ${s.hote} le ${formatDate(s.lu_le)}${auteur ? `, posé par ${auteur}` : ''}`}
                              >
                                Cycle de vie · {libelleStatutLu(s.code)}
                              </span>
                            )
                          })()}
                          {/* Rien sur une lecture incomplète : « À encaisser » serait une affirmation que la liste ne
                              permet pas. Rien non plus quand le statut « Encaissée » est sans objet pour cette facture. */}
                          {encaissementsIncomplets == null && (() => {
                            const pastille = pastilleEncaissement(f, lignesFactures, encaissements, partsEncaissements, statutTva)
                            return pastille ? <span className={`badge badge-une-ligne ${pastille.classe}`}>{pastille.libelle}</span> : null
                          })()}
                          {/* Ce qui reste à DÉCLARER, une seconde pastille : un fait (l'encaissement) et une obligation (sa
                              déclaration) ne partagent pas une couleur. Rien si une seule des listes dont elle dépend est
                              incomplète. */}
                          {encaissementsIncomplets == null && declarationsIncompletes == null && transmissionsIncompletes == null
                            && statutsIncomplets == null && (() => {
                            const pastille = pastilleDeclaration(
                              dossierId, f, lignesFactures, encaissements, declarations, transmissions, evenementsSuperpdp,
                              statutsLus, statutTva, aujourdHui,
                            )
                            return pastille ? <span className={`badge badge-une-ligne ${pastille.classe}`}>{pastille.libelle}</span> : null
                          })()}
                        </div>
                      </td>
                      <td className="td-actions" onClick={(e) => e.stopPropagation()}>
                        {f.statut === 'brouillon' && (
                          <button className="btn btn-danger btn-sm" onClick={() => supprimer(f)}>Supprimer</button>
                        )}
                        {f.statut === 'validee' && (
                          <button className="btn btn-outline btn-sm" onClick={() => setApercu(f)}>Aperçu</button>
                        )}
                        {f.statut === 'validee' && f.type === 'facture' && (
                          // Refusée ou rejetée sur sa plateforme, elle s'annule par un avoir INTERNE : le bouton le dit, et
                          // l'avoir ne se transmettra pas (la fenêtre de transmission et la base le refusent).
                          statutsIncomplets == null && annuleeSurSaPlateforme(statutsLus, f.id) ? (
                            <button
                              className="btn btn-outline btn-sm" onClick={() => setAvoirDe(f)}
                              title={`Refusée ou rejetée sur sa plateforme : ${CONSEQUENCE_ANNULATION}.`}
                            >
                              Avoir interne
                            </button>
                          ) : (
                            <button className="btn btn-outline btn-sm" onClick={() => setAvoirDe(f)}>Avoir</button>
                          )
                        )}
                        {f.statut === 'validee' && (
                          <button className="btn btn-outline btn-sm" onClick={() => setTransmissionDe(f.id)}>Transmettre</button>
                        )}
                        {f.statut === 'validee' && f.type === 'facture' && (
                          <button className="btn btn-outline btn-sm" onClick={() => setEncaissementsDe(f.id)}>Encaissements</button>
                        )}
                        {f.statut === 'validee' && (
                          <button className="btn btn-outline btn-sm" onClick={() => setEmailDe(f)}>Envoyer par e-mail</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <FactureFormModal
          {...(props.espace === 'cabinet'
            ? { espace: 'cabinet' as const, onAdresseUpdated: props.onAdresseUpdated }
            : { espace: 'client' as const })}
          dossierId={dossierId}
          dossierNom={dossierNom}
          dossierSiret={dossierSiret}
          dossierAdresse={dossierAdresse}
          statutTva={statutTva}
          articleExoneration={articleExoneration}
          numeroTvaAttribue={numeroTvaAttribue}
          tvaSurDebits={tvaSurDebits}
          facture={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      {apercu && (
        <FactureApercu
          facture={apercu}
          dossier={{ statut_tva: statutTva, article_exoneration: articleExoneration, numero_tva_attribue: numeroTvaAttribue }}
          onClose={() => setApercu(null)}
        />
      )}

      {avoirDe && (
        <FactureAvoirModal
          dossierId={dossierId}
          espace={espace}
          factureOrigine={avoirDe}
          // Sur la liste ENTIÈRE du dossier, toutes années confondues : un avoir de l'an prochain crédite la
          // facture de cette année. Lue en partie, on ne sait pas ce qui a été crédité, et c'est la base qui juge.
          credite={lectureIncomplete ? null : dejaCredite(avoirDe.id, factures)}
          onClose={() => setAvoirDe(null)}
          onCreated={load}
        />
      )}

      {transmise && (
        <TransmissionFactureModal
          key={transmise.id}
          dossierId={dossierId}
          {...(props.espace === 'cabinet' ? { espace: 'cabinet' as const, acces } : { espace: 'client' as const })}
          facture={transmise}
          statutTva={statutTva}
          articleExoneration={articleExoneration}
          numeroTvaAttribue={numeroTvaAttribue}
          onClose={() => setTransmissionDe(null)}
          onUpdated={load}
        />
      )}

      {encaissee && (
        <EncaissementsFactureModal
          key={encaissee.id}
          {...(props.espace === 'cabinet' ? { espace: 'cabinet' as const, acces } : { espace: 'client' as const, banque: props.banque })}
          dossierId={dossierId}
          facture={encaissee}
          statutTva={statutTva}
          onClose={() => setEncaissementsDe(null)}
          onUpdated={load}
        />
      )}

      {emailDe && (
        <EnvoyerEmailModal
          dossierId={dossierId}
          type="facture"
          factureId={emailDe.id}
          destinataireInitial={emailDe.tiers_email}
          titre={`Envoyer la ${emailDe.type === 'avoir' ? 'note d’avoir' : 'facture'} ${emailDe.numero ?? ''} par e-mail`}
          description="Le détail (lignes, montants, mentions légales) est envoyé dans le corps de l'e-mail — sans pièce jointe PDF pour l'instant."
          onClose={() => setEmailDe(null)}
          onSent={load}
        />
      )}
    </>
  )
}
