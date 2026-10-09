import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/format'
import { sirenDuDossier } from '../../lib/factureElectronique'
import {
  enregistrerConnexionPlateforme,
  lireConnexionPlateforme,
  lireSynchronisationSuperPdp,
  listerFlux,
  preparerReception,
  recevoirFactures,
  repartirDuDebut,
  retirerConnexionPlateforme,
  testerConnexionPlateforme,
  type BilanReception,
  type ConnexionPlateformeVue,
  type DrapeauxPlateforme,
  type FluxVu,
  type ListeFlux,
  type PlanReception,
  type SaisieConnexion,
} from '../../lib/receptionPlateforme'
import {
  compteDesIssues,
  ecartsEnPhrases,
  libelleImporter,
  phraseDeLIssue,
  phrasesDuBilan,
  phrasesDuPlan,
  PRESET_SUPER_PDP,
  refusSaisie,
  SAISIE_VIDE,
  saisieComplete,
  titreDuPlan,
} from '../../lib/plateformeClient'
import { releverEtNommer, type ResultatReleve } from '../../lib/releveStatuts'
import BilanReleveStatuts from './BilanReleveStatuts'

// LA RÉCEPTION DES FACTURES PAR LA PLATEFORME AGRÉÉE DU CLIENT (ligne 28.5 de la feuille de route, étape b). Le
// cabinet relie ici le dossier à la plateforme que son client a choisie — l'accès « client credentials » que le client
// lui ouvre, sur l'API de flux que publient les plateformes, dite « API AFNOR » —, cherche les factures arrivées depuis
// la dernière fois, et les importe : chacune entre en pièce « à valider », comme un dépôt, et rien n'est validé ni
// catégorisé sans lui.
//
// RIEN NE PART CHEZ LA PLATEFORME SANS UN CLIC : ouvrir cette fenêtre ne lit que ce que la base garde de la connexion
// (action « statut » de `plateforme-agreee`) et de la synchronisation Super PDP du dossier. Tester, chercher, importer
// sont des gestes.
//
// UNE SEULE ACTION À LA FOIS (`actionEnCours`, un `useRef` posé avant le `try`) : un retrait pendant un import, ou deux
// imports lancés par deux clics du même rendu, se croiseraient — le second relirait une liste que le premier est en
// train d'importer. Le verrou se relâche APRÈS la relecture de la connexion, sans quoi un second import partirait sur un
// point de reprise que la base vient de déplacer.

const sens = (f: FluxVu) => (f.sens === 'achat' ? 'Achat' : 'Vente')
const nomDuFlux = (f: FluxVu) => f.nom ?? `Facture ${f.id}`

interface Props {
  dossierId: string
  dossierSiret: string | null
  onClose: () => void
  onImported: () => void
}

export default function PlateformeClientModal({ dossierId, dossierSiret, onClose, onImported }: Props) {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const sirenDossier = sirenDuDossier(dossierSiret)

  // `undefined` tant que la base n'a pas répondu ; `null`, aucune connexion.
  const [connexion, setConnexion] = useState<ConnexionPlateformeVue | null | undefined>(undefined)
  const [erreurLecture, setErreurLecture] = useState<string | null>(null)
  const [superPdp, setSuperPdp] = useState<{ configuree: boolean | null; erreur: string | null } | null>(null)
  const [formulaire, setFormulaire] = useState(false)
  const [saisie, setSaisie] = useState<SaisieConnexion>(SAISIE_VIDE)
  const [liste, setListe] = useState<ListeFlux | null>(null)
  const [plan, setPlan] = useState<PlanReception | null>(null)
  const [hashsConnus, setHashsConnus] = useState<Set<string> | null>(null)
  const [progression, setProgression] = useState<[number, number] | null>(null)
  const [bilan, setBilan] = useState<BilanReception | null>(null)
  // Le bilan d'un relevé des statuts des factures émises relu depuis le début (étape d7).
  const [releve, setReleve] = useState<ResultatReleve | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [occupe, setOccupe] = useState(false)
  const actionEnCours = useRef(false)

  async function charger(): Promise<void> {
    const r = await lireConnexionPlateforme(dossierId)
    if (r.erreur !== null) {
      setErreurLecture(r.erreur)
      return
    }
    setErreurLecture(null)
    setConnexion(r.donnees.connexion)
  }

  useEffect(() => {
    let annule = false
    lireConnexionPlateforme(dossierId).then((r) => {
      if (annule) return
      if (r.erreur !== null) setErreurLecture(r.erreur)
      else setConnexion(r.donnees.connexion)
    })
    lireSynchronisationSuperPdp(dossierId).then((r) => { if (!annule) setSuperPdp(r) })
    return () => { annule = true }
  }, [dossierId])

  async function sousVerrou(action: () => Promise<void>): Promise<void> {
    if (actionEnCours.current) return
    actionEnCours.current = true
    setOccupe(true)
    setErreur(null)
    setMessage(null)
    setReleve(null)
    try {
      await action()
    } finally {
      actionEnCours.current = false
      setOccupe(false)
    }
  }

  function oublierLaRecherche() {
    setListe(null)
    setPlan(null)
    setHashsConnus(null)
  }

  // Une connexion changée depuis la recherche (un autre onglet, un collègue) rend la liste caduque : on la relit
  // plutôt que d'importer d'après une configuration qui n'est plus la bonne.
  async function dire(erreurAppel: string, drapeaux: DrapeauxPlateforme): Promise<void> {
    if (drapeaux.perimee) {
      oublierLaRecherche()
      setErreur('La connexion a changé depuis : relancez la recherche.')
      await charger()
      return
    }
    setErreur(erreurAppel)
  }

  function ouvrirFormulaire() {
    setSaisie(connexion ? {
      nom: connexion.nom, url_flux: connexion.url_flux, url_jeton: connexion.url_jeton, client_id: connexion.client_id,
      client_secret: '', organisation_id: connexion.organisation_id ?? '', portee: connexion.portee ?? '',
    } : SAISIE_VIDE)
    setErreur(null)
    setMessage(null)
    setFormulaire(true)
  }

  const creation = !connexion
  const refus = refusSaisie(saisie)
  const enregistrable = refus === null && saisieComplete(saisie, creation)

  function enregistrer(e: FormEvent) {
    e.preventDefault()
    if (!enregistrable) return
    void sousVerrou(async () => {
      const r = await enregistrerConnexionPlateforme(dossierId, saisie)
      if (r.erreur !== null) return dire(r.erreur, r.drapeaux)
      setConnexion(r.donnees.connexion)
      setSaisie(SAISIE_VIDE)
      setFormulaire(false)
      oublierLaRecherche()
      setBilan(null)
      setMessage('Connexion enregistrée. « Tester la connexion » vérifie que la plateforme accepte l’accès.')
    })
  }

  const tester = () => sousVerrou(async () => {
    const r = await testerConnexionPlateforme(dossierId)
    if (r.erreur !== null) return dire(r.erreur, r.drapeaux)
    setMessage('La plateforme répond et accepte l’accès du cabinet.')
  })

  const chercher = () => sousVerrou(async () => {
    setBilan(null)
    oublierLaRecherche()
    const r = await listerFlux(dossierId)
    if (r.erreur !== null) return dire(r.erreur, r.drapeaux)
    const prepare = await preparerReception(dossierId, r.donnees)
    if ('refus' in prepare) {
      setErreur(prepare.refus)
      return
    }
    setListe(r.donnees)
    setPlan(prepare.plan)
    setHashsConnus(prepare.hashsConnus)
  })

  const importer = () => sousVerrou(async () => {
    if (!liste || !plan || !hashsConnus || !sirenDossier || !userId || plan.aImporter.length === 0) return
    setProgression([0, plan.aImporter.length])
    try {
      const resultat = await recevoirFactures(
        { dossierId, userId, version: liste.version, hote: liste.hote, sirenDossier, hashsConnus },
        liste, plan, (faites, total) => setProgression([faites, total]),
      )
      setBilan(resultat)
      oublierLaRecherche()
      if (resultat.issues.some((i) => i.statut === 'importee')) onImported()
    } finally {
      setProgression(null)
    }
    await charger()
  })

  const repartir = () => {
    if (!connexion || actionEnCours.current) return
    if (!window.confirm(
      'Reprendre la recherche depuis le début ? La prochaine recherche relira toutes les factures que la plateforme '
      + 'garde : celles déjà importées seront reconnues et écartées, les autres pourront entrer. Utile après une '
      + 'correction du SIRET du dossier, ou une pièce supprimée par erreur.',
    )) return
    void sousVerrou(async () => {
      const r = await repartirDuDebut(dossierId, connexion.version)
      if (r.erreur !== null) return dire(r.erreur, r.drapeaux)
      oublierLaRecherche()
      setBilan(null)
      setMessage('La prochaine recherche repartira du début.')
      await charger()
    })
  }

  // RELIRE LES STATUTS DEPUIS LE DÉBUT (étape d7) : le relevé des statuts des factures émises repart du premier, comme
  // « Reprendre du début » pour les factures — après une correction de l'application, ou quand un statut a été écarté à
  // tort. Sous le verrou de la fenêtre, et la connexion relue avant de le relâcher : elle dit quand les statuts ont été
  // lus jusqu'au bout. La confirmation nomme ce qu'il fait.
  const relireLesStatuts = () => {
    if (!connexion || actionEnCours.current) return
    if (!window.confirm(
      `Relire depuis le début les statuts des factures émises sur ${connexion.nom} ? L’application relit tous les statuts `
      + 'depuis le premier ; ceux déjà gardés sont reconnus et ne s’écrivent pas deux fois. Utile après une correction de '
      + 'l’application, ou quand un statut a été écarté à tort.',
    )) return
    void sousVerrou(async () => {
      const r = await releverEtNommer(dossierId, true)
      if (r.erreur !== null) setErreur(r.erreur)
      else setReleve(r.resultat)
      await charger()
    })
  }

  const retirer = () => {
    if (actionEnCours.current) return
    if (!window.confirm(
      'Retirer la connexion à la plateforme du client ? Ses identifiants sont effacés de l’application et plus aucune '
      + 'facture ne sera reçue par ce chemin ; les pièces déjà importées restent. L’accès que le client a ouvert au '
      + 'cabinet sur sa plateforme, lui, reste ouvert : demandez-lui de le fermer.',
    )) return
    void sousVerrou(async () => {
      const r = await retirerConnexionPlateforme(dossierId)
      if (r.erreur !== null) return dire(r.erreur, r.drapeaux)
      setConnexion(null)
      oublierLaRecherche()
      setBilan(null)
      setMessage('Connexion retirée.')
    })
  }

  const champ = (cle: keyof SaisieConnexion) => ({
    value: saisie[cle],
    onChange: (e: { target: { value: string } }) => setSaisie((s) => ({ ...s, [cle]: e.target.value })),
  })

  const compte = bilan ? compteDesIssues(bilan.issues) : null
  // Le détail ne redit ni l'interruption, dite à part, ni ce qui était déjà au dossier, compté au-dessus.
  const aSignaler = bilan
    ? bilan.issues.filter((i) => i.statut !== 'interrompu' && i.statut !== 'deja_importee' &&
      (i.statut !== 'importee' || i.avertissements.length > 0))
    : []

  return (
    <div style={overlayStyle}>
      <div className="card plateforme-client" style={{ width: 'min(680px, 94vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Plateforme du client</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Les factures que le client reçoit et émet par sa plateforme agréée arrivent ici, chacune en pièce « à valider » :
          rien n’est validé ni catégorisé sans vous.
        </p>

        {superPdp?.configuree === true && (
          <p className="alerte-tva" style={{ margin: '0 0 12px' }}>
            Ce dossier reçoit aussi ses factures par la synchronisation Super PDP (« 🔌 Facture électronique ») : une
            facture reçue par les deux chemins entrerait deux fois. N’en gardez qu’un.
          </p>
        )}
        {superPdp?.erreur && (
          <p className="muted">
            La synchronisation Super PDP du dossier n’a pas pu être lue ({superPdp.erreur}) : si elle est active, une facture
            reçue par les deux chemins entrerait deux fois.
          </p>
        )}

        {erreurLecture && (
          // Une lecture refusée n'est pas « aucune plateforme reliée » : aucun formulaire n'est offert, qui
          // remplacerait une connexion qu'on n'a pas su lire.
          <div>
            <p className="error-text">La connexion n’a pas pu être lue : {erreurLecture}</p>
            <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => sousVerrou(charger)}>
              Réessayer
            </button>
          </div>
        )}
        {connexion === undefined && !erreurLecture && <p className="muted">Lecture de la connexion…</p>}

        {connexion === null && !formulaire && !erreurLecture && (
          <div>
            <p>Aucune plateforme n’est reliée à ce dossier.</p>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Demandez au client d’ouvrir au cabinet un accès à sa plateforme agréée : une application « client
              credentials » (un identifiant et un secret). Sa plateforme lui donne aussi les deux adresses à saisir ici,
              celle du service des flux (API AFNOR) et celle des jetons.
            </p>
            <button type="button" className="btn btn-primary btn-sm" onClick={ouvrirFormulaire}>
              Relier la plateforme du client
            </button>
          </div>
        )}

        {formulaire && (
          <form onSubmit={enregistrer}>
            <div className="plateforme-actions" style={{ marginBottom: 8 }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setSaisie((s) => ({ ...s, ...PRESET_SUPER_PDP }))}
              >
                Préremplir pour Super PDP
              </button>
            </div>
            <div className="field">
              <label htmlFor="pa-nom">Nom de la plateforme</label>
              <input id="pa-nom" {...champ('nom')} />
            </div>
            <div className="field">
              <label htmlFor="pa-flux">Adresse du service des flux (API AFNOR)</label>
              <input id="pa-flux" placeholder="https://…" {...champ('url_flux')} />
            </div>
            <div className="field">
              <label htmlFor="pa-jeton">Adresse des jetons (OAuth2)</label>
              <input id="pa-jeton" placeholder="https://…" {...champ('url_jeton')} />
            </div>
            <div className="field">
              <label htmlFor="pa-client">Identifiant (client_id)</label>
              <input id="pa-client" autoComplete="off" {...champ('client_id')} />
            </div>
            <div className="field">
              <label htmlFor="pa-secret">Secret (client_secret)</label>
              <input id="pa-secret" type="password" autoComplete="new-password" {...champ('client_secret')} />
              {!creation && <span className="muted">Laissé vide, le secret enregistré est gardé : il ne s’affiche jamais.</span>}
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="pa-orga">Organisation (facultatif)</label>
                <input id="pa-orga" {...champ('organisation_id')} />
              </div>
              <div className="field">
                <label htmlFor="pa-portee">Portée (facultatif)</label>
                <input id="pa-portee" {...champ('portee')} />
              </div>
            </div>
            {refus && <p className="error-text">{refus}</p>}
            <div className="plateforme-actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => setFormulaire(false)}>
                Annuler
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={occupe || !enregistrable}>
                {occupe ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        )}

        {connexion && !formulaire && (
          <div>
            <dl className="plateforme-resume">
              <dt>Plateforme</dt>
              <dd>{connexion.nom} <span className="muted">({connexion.hote})</span></dd>
              <dt>Identifiant</dt>
              <dd>{connexion.client_id}</dd>
              {connexion.organisation_id && (
                <>
                  <dt>Organisation</dt>
                  <dd>{connexion.organisation_id}</dd>
                </>
              )}
              <dt>Recherche</dt>
              <dd>
                {connexion.recherche_depuis
                  ? `reprend aux factures mises à jour après le ${formatDate(connexion.recherche_depuis)}`
                  : 'part du début'}
              </dd>
              <dt>Dernière récupération</dt>
              <dd>{connexion.derniere_recuperation ? formatDate(connexion.derniere_recuperation) : 'jamais'}</dd>
              <dt>Statuts des factures émises</dt>
              <dd>
                {connexion.cycle_vie_lu_le
                  ? `lus jusqu’au bout le ${formatDate(connexion.cycle_vie_lu_le)} — l’onglet Factures les relève`
                  : 'pas encore lus jusqu’au bout — l’onglet Factures les relève'}
              </dd>
            </dl>

            <div className="plateforme-actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={occupe} onClick={chercher}>
                Chercher les nouvelles factures
              </button>
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={tester}>
                Tester la connexion
              </button>
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={ouvrirFormulaire}>
                Modifier
              </button>
              {connexion.recherche_depuis && (
                <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={repartir}>
                  Reprendre du début
                </button>
              )}
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={relireLesStatuts}>
                Relire les statuts depuis le début
              </button>
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={retirer}>
                Retirer
              </button>
            </div>
          </div>
        )}

        {liste && plan && (
          <div className="plateforme-plan">
            <h3>{titreDuPlan(plan.aImporter.length)}</h3>
            {!liste.complete && (
              <p className="alerte-tva">
                Liste incomplète : {liste.motif}. Importez celles-ci, puis relancez la recherche pour la suite.
              </p>
            )}
            {plan.aImporter.length > 0 && (
              <ul className="plateforme-liste">
                {plan.aImporter.map((f) => (
                  <li key={f.id}>
                    <span className="badge badge-neutral">{sens(f)}</span> {nomDuFlux(f)}
                    <span className="muted"> — {f.recu_le ? `reçue le ${formatDate(f.recu_le)}` : `mise à jour le ${formatDate(f.mis_a_jour)}`}</span>
                  </li>
                ))}
              </ul>
            )}
            <ul className="plateforme-liste muted">
              {phrasesDuPlan(plan).map((p) => <li key={p}>{p}</li>)}
              {ecartsEnPhrases(liste.ecartes).map((p) => <li key={p}>{p}.</li>)}
            </ul>
            {plan.aImporter.length > 0 && !sirenDossier && (
              <p className="error-text">
                Renseignez le SIRET du dossier (onglet Informations) avant d’importer : c’est lui qui vérifie que chaque
                facture est bien adressée au client de ce dossier.
              </p>
            )}
            {plan.aImporter.length > 0 && (
              <div className="plateforme-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={occupe || !sirenDossier || !userId}
                  onClick={importer}
                >
                  {progression ? `Import… ${progression[0]} sur ${progression[1]}` : libelleImporter(plan.aImporter.length)}
                </button>
              </div>
            )}
          </div>
        )}

        {bilan && compte && (
          <div className="plateforme-bilan">
            <h3>Import terminé</h3>
            <ul className="plateforme-liste">
              {phrasesDuBilan(compte).map((p) => <li key={p}>{p}</li>)}
            </ul>
            {aSignaler.length > 0 && (
              <ul className="plateforme-liste plateforme-a-signaler">
                {aSignaler.map((i) => <li key={i.flux.id}>{nomDuFlux(i.flux)} : {phraseDeLIssue(i)}</li>)}
              </ul>
            )}
            {bilan.interruption && (
              <p className="error-text">
                Import interrompu : {bilan.interruption.message} Les factures non faites reviendront à la prochaine recherche.
              </p>
            )}
            {bilan.erreurReprise && (
              <p className="error-text">
                Le point de reprise n’a pas pu être enregistré ({bilan.erreurReprise}) : la prochaine recherche relira ces
                factures, et reconnaîtra celles déjà importées.
              </p>
            )}
          </div>
        )}

        {releve && <BilanReleveStatuts resultat={releve} />}
        {message && <p className="muted">{message}</p>}
        {erreur && <p className="error-text">{erreur}</p>}

        <div className="plateforme-actions" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={occupe}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
