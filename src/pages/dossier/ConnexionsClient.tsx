import { useEffect, useState } from 'react'
import { lireSynchronisationSuperPdp, type ConnexionPlateformeVue } from '../../lib/receptionPlateforme'
import { pourLEspace } from '../../lib/espaceVentes'
import { aujourdHuiAParis } from '../../lib/format'
import { useAdressesReception } from '../../lib/useAdressesReception'
import { direLaPriseEffet, direLaVerification, libelleMaille, resumeDesAdresses } from '../../lib/adressesReceptionVue'
import AdresseReceptionModal from './AdresseReceptionModal'
import PlateformeClientModal from './PlateformeClientModal'
import SuperPdpModal from './SuperPdpModal'

// LES CONNEXIONS DU CLIENT, DANS « MES VENTES » (espace client, étape P4b ; conception : HISTORIQUE.md, « L'ESPACE CLIENT
// DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION », §5.1). Sous l'hypothèse EC-Q4 — « le client relie aussi sa
// plateforme », pas encore tranchée par le cabinet —, que les fonctions de la vente honorent depuis P3 (`src/test/quiPeutQuoi.ts`) :
// l'état de sa plateforme agréée et de Super PDP, et les deux fenêtres du cabinet en mode client, où seuls les gestes de la
// vente existent. Le jour où le cabinet répondrait « le cabinet seul », cette section se retire avec la ligne de la table.
//
// RIEN NE PART CHEZ UNE PLATEFORME À L'OUVERTURE : la connexion est celle que l'onglet a lue (action « statut » de
// `plateforme-agreee`, qui ne lit que la base), Super PDP se lit de même (`superpdp-credentials`, action « status »). Rien ne
// se dit avant la réponse — « aucune n'est reliée » d'une connexion qu'on n'a pas lue serait faux —, et une lecture ratée
// se dit avec son motif, sans geste qui la remplacerait. À la fermeture d'une fenêtre, les deux se relisent : elle a pu
// relier, modifier ou retirer.
//
// UN TROISIÈME BLOC, « Ton adresse de réception » (étape A6b1, MEG1-Q16) : l'adresse sous laquelle ta société reçoit ses
// factures électroniques, DÉCLARÉE par le client « Ventes » ou son cabinet. Même règle : rien ne se dit avant la lecture ;
// « aucune adresse » seulement d'une liste lue en entier ; lue en partie ou en lignes qui ne font pas une chaîne, le bloc le
// dit et n'offre que « Réessayer ». Il ne lit que la base (rien n'est envoyé à l'annuaire) ; sa fenêtre est la même que celle
// du cabinet (`AdresseReceptionModal`, `espace="client"`), et à sa fermeture le bloc se relit.

interface Props {
  dossierId: string
  /** La connexion lue par l'onglet : `undefined` tant qu'elle n'est pas lue, ou quand sa lecture a échoué. */
  connexion: ConnexionPlateformeVue | null | undefined
  connexionErreur: string | null
  /** Relit la connexion de l'onglet (après une fenêtre, ou sur « Réessayer »). */
  relireConnexion: () => Promise<void>
}

type EtatSuperPdp = { configuree: boolean; erreur: null } | { configuree: null; erreur: string }

export default function ConnexionsClient({ dossierId, connexion, connexionErreur, relireConnexion }: Props) {
  const dire = (texte: string) => pourLEspace('client', texte)
  // `null` tant que la base n'a pas répondu.
  const [superPdp, setSuperPdp] = useState<EtatSuperPdp | null>(null)
  const [ouverte, setOuverte] = useState<'plateforme' | 'superpdp' | 'adresse' | null>(null)
  const { lu: adresses, relire: relireAdresses } = useAdressesReception(dossierId)

  useEffect(() => {
    let annule = false
    lireSynchronisationSuperPdp(dossierId).then((r) => { if (!annule) setSuperPdp(r) })
    return () => { annule = true }
  }, [dossierId])

  async function relireSuperPdp() {
    setSuperPdp(null)
    setSuperPdp(await lireSynchronisationSuperPdp(dossierId))
  }

  const aujourdhui = aujourdHuiAParis()
  const resumeAdresse = adresses === null ? null : resumeDesAdresses(adresses.adresses, dossierId, aujourdhui)

  function fermer() {
    setOuverte(null)
    void relireConnexion()
    void relireSuperPdp()
    void relireAdresses(true)
  }

  return (
    <section className="connexions-client" aria-labelledby="connexions-client-titre">
      <h3 id="connexions-client-titre">Tes plateformes</h3>
      <div className="plateforme-statuts">
        {connexionErreur ? (
          <p>
            Ta plateforme agréée : {dire(connexionErreur)} Elle ne se relie ni ne se relève d’ici tant qu’elle n’est pas lue.
          </p>
        ) : connexion === undefined ? (
          <p className="muted">Ta plateforme agréée : lecture…</p>
        ) : connexion === null ? (
          <p>
            Ta plateforme agréée : aucune n’est reliée à ta société. Relie celle par laquelle ta société émet ses factures
            pour les y transmettre d’ici et en relever les statuts.
          </p>
        ) : (
          <p>Ta plateforme agréée : {connexion.nom} <span className="muted">({connexion.hote})</span>, reliée à ta société.</p>
        )}
        {connexionErreur ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void relireConnexion()}>Réessayer</button>
        ) : connexion !== undefined && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setOuverte('plateforme')}>
            {connexion ? 'Gérer ta plateforme' : 'Relier ta plateforme'}
          </button>
        )}
      </div>
      <div className="plateforme-statuts">
        {superPdp === null ? (
          <p className="muted">Super PDP : lecture…</p>
        ) : superPdp.erreur !== null ? (
          <p>Super PDP : {dire(superPdp.erreur)}</p>
        ) : superPdp.configuree ? (
          <p>Super PDP : relié à ta société.</p>
        ) : (
          <p>Super PDP : pas relié à ta société. Relie-le si ta société y émet ses factures.</p>
        )}
        {superPdp?.erreur != null ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void relireSuperPdp()}>Réessayer</button>
        ) : superPdp !== null && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setOuverte('superpdp')}>
            {superPdp.configuree ? 'Gérer Super PDP' : 'Relier Super PDP'}
          </button>
        )}
      </div>

      <div className="plateforme-statuts">
        {resumeAdresse === null ? (
          <p className="muted">Ton adresse de réception : lecture…</p>
        ) : resumeAdresse.etat === 'incomplete' ? (
          <p>
            Ton adresse de réception : elle n’a pas pu être lue en entier ({resumeAdresse.motif}). Elle ne se déclare pas d’ici
            tant qu’elle n’est pas lue.
          </p>
        ) : resumeAdresse.etat === 'rompue' ? (
          <p>
            Ton adresse de réception : ses versions lues ne forment pas une suite, aucune n’est donc dite courante. Elle ne se
            déclare pas d’ici tant qu’elle n’est pas lue correctement.
          </p>
        ) : resumeAdresse.etat === 'aucune' ? (
          <p>
            Ton adresse de réception : tu n’en as pas encore déclaré. Déclare celle sous laquelle ta société reçoit ses factures
            électroniques, vérifiée sur le portail de l’annuaire ou sur ta plateforme.
          </p>
        ) : (
          <p>
            Ton adresse de réception : {resumeAdresse.adresse.identifiant} ({libelleMaille(resumeAdresse.adresse.forme)}), chez{' '}
            {resumeAdresse.adresse.plateforme}. {direLaPriseEffet(resumeAdresse.adresse.prise_effet, aujourdhui)}.{' '}
            {direLaVerification(resumeAdresse.adresse)}.
          </p>
        )}
        {resumeAdresse?.etat === 'incomplete' || resumeAdresse?.etat === 'rompue' ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void relireAdresses(true)}>Réessayer</button>
        ) : resumeAdresse !== null && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setOuverte('adresse')}>
            {resumeAdresse.etat === 'courante' ? 'Gérer ton adresse' : 'Déclarer ton adresse'}
          </button>
        )}
      </div>

      {ouverte === 'plateforme' && <PlateformeClientModal espace="client" dossierId={dossierId} onClose={fermer} />}
      {ouverte === 'superpdp' && <SuperPdpModal espace="client" dossierId={dossierId} onClose={fermer} />}
      {ouverte === 'adresse' && <AdresseReceptionModal espace="client" dossierId={dossierId} onClose={fermer} />}
    </section>
  )
}
