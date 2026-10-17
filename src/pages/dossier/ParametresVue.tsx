import { useEffect, useRef, useState } from 'react'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { messageErreur } from '../../lib/messageErreur'
import { pourLEspace } from '../../lib/espaceVentes'
import { ACCES_SANS_OBJET, type AccesDuDossier } from '../../lib/auteursVentes'
import { jourEtHeureAParis, type SaisieParametresFacturation } from '../../lib/parametresFacturation'
import { lireLesParametresFacturation, type LectureDesParametres } from '../../lib/parametresFacturationLecture'
import { confirmerRib, enregistrerParametresFacturation } from '../../lib/parametresFacturationEcriture'
import {
  TEXTE_ROMPUE, conditionsDeLaVersion, confirmationDuRib, etatDuRibDit, historiqueDesParametres, mentionVersionParLeClient,
  parametresEnvoyes, pastilleDuRib, phraseDEnTete, refusDeLaConfirmation, refusDeLaSaisieParametres, resumeDesParametres, ribDeLaVersion,
  ribEnVigueurDit, saisieDeLaVersion, saisieProposee, type ChampAffiche,
} from '../../lib/parametresFacturationVue'
import type { ParametresFacturation } from '../../lib/types'
import ConfirmationArticle from './ConfirmationArticle'
import ParametresSaisieModal from './ParametresSaisieModal'

// « PARAMÈTRES » (espace client, étape A5b1 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE
// PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.5.2 et « LA FRAUDE AU FAUX RIB » ; MEG1-Q12, MEG1-Q13, A5-Q4 à A5-Q6) : les
// paramètres de facturation du dossier — le délai, le moyen proposé, l'escompte, les pénalités, des mentions, un pied de page
// et le RIB. La cinquième vue de l'onglet Factures, après « Clients » : au cabinet dans l'onglet, au client « Ventes » dans
// « Mes ventes ». Elle montre la version COURANTE et l'état de son RIB, l'historique dès deux versions, et offre « Modifier les
// paramètres » (une version NOUVELLE, tous les champs) et, au cabinet seul, « Confirmer le RIB ». L'identité légale du dossier,
// l'avis d'un changement de RIB sur les accueils, le logo et tout ce qu'une facture lira sont d'autres étapes.
//
// RIEN AVANT LA LECTURE, RIEN SUR UNE LECTURE PARTIELLE : « Chargement… » tant que les versions ne sont pas revenues ; lue en
// partie, refusée ou en versions qui ne font pas une chaîne, la vue le dit et n'offre AUCUN geste — une version qu'on n'aurait
// pas lue ferait dire « courante » d'une version remplacée, et « en vigueur » d'un RIB qui ne l'est plus.
//
// UN SEUL VERROU POUR LES DEUX GESTES (`gesteEnCours`, un `useRef` posé AVANT le `try`) : relâché dans le `finally`, APRÈS la
// relecture — un second clic pendant qu'elle court écrirait sur ce que la vue montrait avant —, relue aussi sur un refus, pour
// que la vue dise ce que la base a gardé (une autre saisie passée entre-temps, que le module nomme alors avant le clic).
type QuiRegarde = { espace: 'cabinet'; acces: AccesDuDossier } | { espace: 'client' }

type Props = QuiRegarde & { dossierId: string }

// La lecture, gardée AVEC le dossier pour lequel elle a été faite : un autre dossier repart en chargement, et la réponse
// tardive d'un dossier quitté ne s'affiche pas.
type Lecture = { cle: string; lu: LectureDesParametres }

// Le formulaire : la version qu'il remplace, RETENUE À SON OUVERTURE (nulle pour une première), et sa saisie de départ.
type Fenetre = { remplace: ParametresFacturation | null; depart: SaisieParametresFacturation }

const CONSEQUENCE_PARTIELLE = 'Aucun geste n’est donc offert : une version qu’on n’aurait pas lue ferait dire « courante » '
  + 'd’une version remplacée, et « en vigueur » d’un RIB qui ne l’est plus.'

export default function ParametresVue(props: Props) {
  const { dossierId, espace } = props
  const client = espace === 'client'
  const dire = (texte: string) => pourLEspace(espace, texte)
  const acces = props.espace === 'cabinet' ? props.acces : ACCES_SANS_OBJET
  const [lecture, setLecture] = useState<Lecture | null>(null)
  const [fenetre, setFenetre] = useState<Fenetre | null>(null)
  // La confirmation ouverte : la version telle que la vue l'a lue à l'ouverture, que la confirmation nomme.
  const [aConfirmer, setAConfirmer] = useState<ParametresFacturation | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const gesteEnCours = useRef(false)
  // Le dossier que la vue affiche, pour qu'une relecture lancée sous un dossier quitté depuis ne s'inscrive pas.
  const dossierAffiche = useRef(dossierId)

  // La première lecture, et celle d'un autre dossier : une réponse arrivée après un changement de dossier ne s'inscrit pas.
  // La lecture ne rejette jamais (son échec tombe du côté signalé).
  useEffect(() => {
    let annule = false
    dossierAffiche.current = dossierId
    lireLesParametresFacturation(dossierId).then((lu) => { if (!annule) setLecture({ cle: dossierId, lu }) })
    return () => { annule = true }
  }, [dossierId])

  // La relecture d'après une écriture : les gestes sont sous verrou, deux relectures ne se croisent donc pas.
  async function relire() {
    const lu = await lireLesParametresFacturation(dossierId)
    if (dossierAffiche.current === dossierId) setLecture({ cle: dossierId, lu })
  }

  // Le verrou des deux gestes. Posé avant le `try` : dans le `try`, le `return` du deuxième clic sortirait par le `finally` et
  // relâcherait le verrou du PREMIER, encore en cours.
  async function sousVerrou(repli: string, ecrire: () => Promise<string>): Promise<boolean> {
    if (gesteEnCours.current) return false
    gesteEnCours.current = true
    setOccupe(true)
    setErreur(null)
    setMessage(null)
    let reussi = false
    try {
      setMessage(await ecrire())
      reussi = true
    } catch (e) {
      setErreur(dire(messageErreur(e, repli)))
    } finally {
      await relire()
      gesteEnCours.current = false
      setOccupe(false)
    }
    return reussi
  }

  const courante = lecture?.cle === dossierId ? lecture.lu : null
  if (courante == null) return <p className="muted">Chargement…</p>

  const versions = courante.lignes
  const resume = resumeDesParametres(courante, dossierId)
  // Aucun geste ne part d'une lecture partielle ni d'une chaîne rompue.
  const peutEcrire = resume.etat === 'aucune' || resume.etat === 'courante'

  async function enregistrer(saisie: SaisieParametresFacturation, remplace: ParametresFacturation | null) {
    // Seconde ceinture : le bouton est déjà grisé sous ce refus.
    const refus = refusDeLaSaisieParametres(dossierId, remplace?.id ?? null, saisie, versions)
    if (refus) {
      setErreur(refus === 'rompue' ? TEXTE_ROMPUE : dire(refus.message))
      return
    }
    const fait = await sousVerrou('Les paramètres de facturation n’ont pas pu être enregistrés.', async () => {
      // La saisie et le logo de la version remplacée, repris (étape A5c1) : ce formulaire ne l'offre pas, il ne le retire pas.
      const ecrite = await enregistrerParametresFacturation(dossierId, remplace?.id ?? null, parametresEnvoyes(remplace, saisie))
      return `Paramètres enregistrés le ${jourEtHeureAParis(ecrite.cree_le)}.`
    })
    if (fait) setFenetre(null)
  }

  async function confirmer(version: ParametresFacturation) {
    const refus = refusDeLaConfirmation(dossierId, version.id, versions)
    if (refus) {
      setErreur(refus === 'rompue' ? TEXTE_ROMPUE : refus.message)
      return
    }
    const fait = await sousVerrou('Le RIB n’a pas pu être confirmé.', async () => {
      await confirmerRib(dossierId, version.id)
      return 'RIB confirmé.'
    })
    if (fait) setAConfirmer(null)
  }

  function ouvrir(remplace: ParametresFacturation | null) {
    setErreur(null)
    setMessage(null)
    setFenetre({ remplace, depart: remplace ? saisieDeLaVersion(remplace) : saisieProposee() })
  }

  function proposerLaConfirmation(version: ParametresFacturation) {
    setErreur(null)
    setMessage(null)
    setAConfirmer(version)
  }

  const historique = historiqueDesParametres(versions, dossierId, espace, acces)
  const confirmation = aConfirmer ? confirmationDuRib(versions, dossierId, aConfirmer, acces) : null
  const refusConfirmation = aConfirmer ? refusDeLaConfirmation(dossierId, aConfirmer.id, versions) : null

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>{phraseDEnTete(espace)}</p>

      <BandeauLecturePartielle
        quoi={client ? 'Tes paramètres de facturation' : 'Les paramètres de facturation du dossier'} accord="lus"
        motif={resume.etat === 'incomplete' ? resume.motif : null} consequence={CONSEQUENCE_PARTIELLE} technique={!client}
      />
      {resume.etat === 'rompue' && <p className="error-text">{TEXTE_ROMPUE}</p>}

      {!fenetre && !aConfirmer && erreur && <p className="error-text" role="alert">{erreur}</p>}
      {message && <p role="status">{message}</p>}

      {resume.etat === 'aucune' && (
        <div className="card">
          <p style={{ marginTop: 0 }}>
            {client ? 'Tu n’as encore enregistré aucun paramètre de facturation.' : 'Aucun paramètre de facturation n’est enregistré pour ce dossier.'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={occupe} onClick={() => ouvrir(null)}>
              Renseigner les paramètres
            </button>
          </div>
        </div>
      )}

      {resume.etat === 'courante' && (() => {
        const v = resume.version
        const auteur = mentionVersionParLeClient(acces, v)
        const rib = ribDeLaVersion(v)
        const pastille = pastilleDuRib(v)
        const etatRib = etatDuRibDit(versions, dossierId, v.id, espace, acces)
        const enVigueur = ribEnVigueurDit(versions, dossierId, espace)
        return (
          <div className="card">
            <h3 style={{ margin: '0 0 4px', fontSize: '1rem' }}>Paramètres en cours</h3>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: '0.84rem' }}>
              Enregistrés le {jourEtHeureAParis(v.cree_le)}
              {auteur && <> <span className="badge badge-neutral badge-une-ligne" title={auteur.titre}>{auteur.libelle}</span></>}
            </p>
            <Champs champs={conditionsDeLaVersion(v)} nom="Conditions" />

            <h3 style={{ margin: '14px 0 6px', fontSize: '1rem' }}>
              RIB{' '}
              {pastille && <span className={`badge ${pastille === 'Proposé' ? 'badge-warning' : 'badge-neutral'} badge-une-ligne`}>{pastille}</span>}
            </h3>
            {rib ? <Champs champs={rib} nom="RIB" /> : null}
            {typeof etatRib === 'string' && <p style={{ margin: '0 0 8px' }}>{etatRib}</p>}
            {enVigueur && (
              <div className="note-info" style={{ marginBottom: 8 }}>
                <p style={{ margin: 0 }}>{enVigueur.phrase}</p>
                {enVigueur.rib && <Champs champs={enVigueur.rib} nom="RIB en vigueur" />}
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={occupe} onClick={() => ouvrir(v)}>
                Modifier les paramètres
              </button>
              {/* Le cabinet seul confirme ; la vue du client n'a pas ce geste (la base le lui refuserait). */}
              {!client && v.iban !== null && v.rib_etat === 'propose' && (
                <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => proposerLaConfirmation(v)}>
                  Confirmer le RIB
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {peutEcrire && Array.isArray(historique) && historique.length > 1 && (
        <>
          <h3 style={{ margin: '16px 0 8px', fontSize: '1rem' }}>Historique</h3>
          <div className="card table-scroll" style={{ padding: 0 }}>
            <div className="tableau-adaptable">
              <table className="table-empilable table-empilable-en-carte" aria-label="Historique des paramètres">
                <thead>
                  <tr><th>Version</th><th>Enregistrée</th><th>Changements</th><th>RIB</th></tr>
                </thead>
                <tbody>
                  {historique.map((h) => (
                    <tr key={h.version.id}>
                      <td data-libelle="Version">{h.courante ? 'Courante' : 'Remplacée'}</td>
                      <td data-libelle="Enregistrée">
                        <div className="pastilles-empilees">
                          <span>{h.quand}</span>
                          {h.parLeClient && <span className="badge badge-neutral badge-une-ligne" title={h.parLeClient.titre}>{h.parLeClient.libelle}</span>}
                        </div>
                      </td>
                      <td data-libelle="Changements">
                        {h.changes === null ? 'Première version' : h.changes.length === 0 ? 'Aucun champ changé' : h.changes.join(' ; ')}
                      </td>
                      <td data-libelle="RIB">{h.rib}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {fenetre && peutEcrire && (
        <ParametresSaisieModal
          dossierId={dossierId}
          espace={espace}
          remplace={fenetre.remplace}
          depart={fenetre.depart}
          versions={versions}
          occupe={occupe}
          erreur={erreur}
          onEnregistrer={(saisie) => enregistrer(saisie, fenetre.remplace)}
          onClose={() => setFenetre(null)}
        />
      )}

      {aConfirmer && !client && peutEcrire && (
        <ConfirmationArticle
          titre="Confirmer le RIB"
          boutonLabel="Confirmer le RIB"
          occupe={occupe}
          refus={refusConfirmation === 'rompue' ? TEXTE_ROMPUE : refusConfirmation?.message ?? (confirmation ? null : 'Cette version n’a pas de RIB proposé à confirmer.')}
          erreur={erreur}
          onConfirmer={() => confirmer(aConfirmer)}
          onAnnuler={() => setAConfirmer(null)}
        >
          {confirmation && (
            <>
              <Champs champs={confirmation.rib} nom="RIB à confirmer" />
              <p>{confirmation.propose}</p>
              <p>{confirmation.fait}</p>
              <p className="note-info">{confirmation.conseil}</p>
            </>
          )}
        </ConfirmationArticle>
      )}
    </>
  )
}

// Une liste de champs, chacun sous son libellé ; un champ vide dit tel, en discret.
function Champs({ champs, nom }: { champs: readonly ChampAffiche[]; nom: string }) {
  return (
    <dl className="plateforme-resume" aria-label={nom}>
      {champs.map((c) => (
        <div key={c.champ} style={{ display: 'contents' }}>
          <dt>{c.libelle}</dt>
          <dd className={c.vide ? 'muted' : undefined} style={{ whiteSpace: 'pre-line' }}>{c.valeur}</dd>
        </div>
      ))}
    </dl>
  )
}
