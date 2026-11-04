import { useEffect, useRef, useState } from 'react'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import { pourLEspace, type EspaceVentes } from '../../lib/espaceVentes'
import {
  LIBELLES_ETAT_DEVIS, confirmationDeLEmission, confirmationDeLaSuppressionDevis, ecritureDuDevis, etatDuDevis, factureTireeDe,
  lignesSaisiesDuDevis, refusDeLaSaisieDevis, refusSuppressionDevis, saisieDuDevis, type CibleDevis, type EtatDevis,
  type SaisieDevis,
} from '../../lib/devis'
import { lireLesDevis, type LectureDesDevis } from '../../lib/devisLecture'
import { enregistrerDevis, supprimerBrouillonDevis } from '../../lib/devisEcriture'
import type { ArticleExoneration, Devis, StatutTva } from '../../lib/types'
import DevisSaisieModal from './DevisSaisieModal'

// « DEVIS » (espace client, étape P6a1 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU
// CLIENT : LA CONCEPTION », §2.3 et §4.3) : la liste des devis du dossier et les gestes d'un brouillon — créer, modifier,
// émettre, supprimer. La vue « Devis » de l'onglet Factures, au cabinet dans l'onglet, au client « Ventes » dans « Mes
// ventes », offerte seulement quand les migrations des devis sont en base (`DEVIS_EXPORTES`, FacturesTab). Répondre à un
// devis, le transformer en facture, l'aperçu et l'e-mail viennent ensuite (étape P6a2).
//
// QUI ÉCRIT : le cabinet ET le client « Ventes », par les mêmes fonctions (`enregistrer_devis`, `supprimer_brouillon_devis`) ;
// ce qu'elles refuseraient se dit avant le clic par lib/devis.ts, et la base juge encore — son refus se dit sous ses mots,
// réécrits pour le client (`pourLEspace`).
//
// RIEN AVANT LA LECTURE, RIEN SUR UNE LECTURE PARTIELLE : « Chargement… » tant que les devis ne sont pas revenus ; un vide ne
// se dit que d'une liste lue en entier ; lue en partie, refusée ou rompue, la vue le dit et n'offre AUCUN geste.
//
// UN SEUL VERROU POUR LES GESTES (`gesteEnCours`, un `useRef` posé AVANT le `try`), relâché dans le `finally` APRÈS la
// relecture : un second clic pendant qu'elle court écrirait sur ce que la liste montrait avant.
type Props = {
  espace: EspaceVentes
  dossierId: string
  // L'émetteur, tel que l'onglet le lit : figé à l'émission.
  dossierNom: string
  dossierSiret: string | null
  dossierAdresse: string | null
  statutTva: StatutTva | null
  articleExoneration: ArticleExoneration | null
}

// La fenêtre ouverte : un devis neuf (`devis` nul) ou le brouillon tel que la liste l'a lu.
type Fenetre = { devis: Devis | null }

const CONSEQUENCE_PARTIELLE = 'Aucun geste n’est donc offert : un devis qu’on n’a pas lu, ou la facture tirée d’un devis, '
  + 'manquerait à la liste, et son état se dirait faux.'

const CLASSE_ETAT: Readonly<Record<EtatDevis, string>> = {
  brouillon: 'badge-warning',
  en_attente: 'badge-neutral',
  expire: 'badge-neutral',
  accepte: 'badge-ok',
  refuse: 'badge-neutral',
  facture: 'badge-ok',
}

export default function DevisVue(props: Props) {
  const { espace, dossierId, statutTva, articleExoneration } = props
  const dire = (texte: string) => pourLEspace(espace, texte)
  const [lecture, setLecture] = useState<LectureDesDevis | null>(null)
  const [fenetre, setFenetre] = useState<Fenetre | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [erreurFenetre, setErreurFenetre] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const gesteEnCours = useRef(false)
  // Le dossier que la vue affiche, pour qu'une relecture lancée sous un dossier quitté depuis ne s'inscrive pas.
  const dossierAffiche = useRef(dossierId)

  // La lecture ne rejette jamais ; une réponse arrivée après un changement de dossier ne s'inscrit pas.
  useEffect(() => {
    let annule = false
    dossierAffiche.current = dossierId
    lireLesDevis(dossierId).then((lu) => { if (!annule) setLecture(lu) })
    return () => { annule = true }
  }, [dossierId])

  async function relire() {
    const lu = await lireLesDevis(dossierId)
    if (dossierAffiche.current === dossierId) setLecture(lu)
  }

  // Le jour à Paris, lu au rendu : l'état « expiré » et le refus d'une émission datée de l'avenir le jugent comme la base.
  const aujourdHui = aujourdHuiAParis()
  const courante = lecture?.dossierId === dossierId ? lecture : null
  if (courante == null) return <p className="muted">Chargement…</p>
  if (courante.etat === 'echec') {
    return (
      <p className="error-text">
        {espace === 'client' ? 'Tes devis ne s’affichent pas' : 'Les devis ne s’affichent pas'} : {courante.motif}. Rouvre cette vue
        pour les relire.
      </p>
    )
  }

  const { devis, liens, complete, motif } = courante
  // Aucun geste ne part d'une liste lue en partie.
  const peutEcrire = complete
  // Le plus récent d'abord : la date du devis, puis sa création.
  const affiches = [...devis].sort((a, b) =>
    b.date_emission.localeCompare(a.date_emission) || b.cree_le.localeCompare(a.cree_le) || b.id.localeCompare(a.id))

  // Le verrou des gestes. Posé avant le `try` : dans le `try`, le `return` du deuxième clic sortirait par le `finally` et
  // relâcherait le verrou du PREMIER, encore en cours.
  async function sousVerrou(repli: string, ecrire: () => Promise<string>, surErreur: (texte: string) => void): Promise<boolean> {
    if (gesteEnCours.current) return false
    gesteEnCours.current = true
    setOccupe(true)
    setErreur(null)
    setErreurFenetre(null)
    setMessage(null)
    let reussi = false
    try {
      setMessage(await ecrire())
      reussi = true
    } catch (e) {
      surErreur(dire(messageErreur(e, repli)))
    } finally {
      await relire()
      gesteEnCours.current = false
      setOccupe(false)
    }
    return reussi
  }

  async function enregistrer(saisie: SaisieDevis, emettre: boolean, vise: Devis | null) {
    if (gesteEnCours.current) return
    const cible: CibleDevis = vise ? { nouveau: false, devis: vise } : { nouveau: true }
    // Seconde ceinture : le bouton est déjà grisé sous ce refus.
    const refus = refusDeLaSaisieDevis(dossierId, cible, saisie, emettre, aujourdHui)
    if (refus) {
      setErreurFenetre(dire(refus))
      return
    }
    if (emettre && !window.confirm(dire(confirmationDeLEmission(saisie)))) return
    const fait = await sousVerrou(
      emettre ? 'Le devis n’a pas pu être émis.' : 'Le brouillon n’a pas pu être enregistré.',
      async () => {
        const ecrit = await enregistrerDevis(dossierId, vise?.id ?? null, ecritureDuDevis(saisie, emettre))
        return emettre ? `Devis ${ecrit.numero ?? ''} émis.` : 'Brouillon de devis enregistré.'
      },
      setErreurFenetre,
    )
    if (fait) setFenetre(null)
  }

  async function supprimer(d: Devis) {
    if (gesteEnCours.current) return
    const refus = refusSuppressionDevis(dossierId, d)
    if (refus) {
      setErreur(dire(refus.message))
      return
    }
    if (!window.confirm(dire(confirmationDeLaSuppressionDevis(d)))) return
    await sousVerrou('Le brouillon n’a pas pu être supprimé.', async () => {
      await supprimerBrouillonDevis(dossierId, d.id)
      return 'Brouillon de devis supprimé.'
    }, setErreur)
  }

  function ouvrir(d: Devis | null) {
    setErreur(null)
    setErreurFenetre(null)
    setMessage(null)
    setFenetre({ devis: d })
  }

  const defauts = {
    aujourdHui, statutTva, articleExoneration,
    emetteurNom: props.dossierNom, emetteurSiret: props.dossierSiret, emetteurAdresse: props.dossierAdresse,
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {espace === 'client'
          ? 'Tes devis : un brouillon se modifie, puis s’émet — il prend alors son numéro et ne se modifie plus. Ton cabinet les '
            + 'lit aussi, et les tient avec toi.'
          : 'Les devis du dossier : un brouillon se modifie, puis s’émet — il prend alors son numéro et ne se modifie plus. Le '
            + 'client qui porte la case « Ventes » les lit et les tient avec vous.'}
      </p>

      <BandeauLecturePartielle
        quoi={espace === 'client' ? 'Tes devis' : 'Les devis du dossier'} accord="lus" motif={complete ? null : (motif ?? 'lecture incomplète')}
        consequence={CONSEQUENCE_PARTIELLE} technique={espace === 'cabinet'}
      />

      {peutEcrire && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={occupe} onClick={() => ouvrir(null)}>+ Nouveau devis</button>
        </div>
      )}

      {erreur && <p className="error-text" role="alert">{erreur}</p>}
      {message && <p className="muted" role="status">{message}</p>}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {affiches.length === 0 ? (
          <div className="empty-state">
            {!complete ? 'La liste des devis n’a pas pu être lue en entier.'
              : espace === 'client' ? 'Tu n’as encore aucun devis.' : 'Aucun devis pour ce dossier.'}
          </div>
        ) : (
          <div className="tableau-adaptable">
            <table className="table-empilable table-empilable-en-carte" aria-label="Devis">
              <thead>
                <tr>
                  <th>Numéro</th><th>Date</th><th>Client</th><th>Montant TTC</th><th>État</th>
                  {peutEcrire && <th></th>}
                </tr>
              </thead>
              <tbody>
                {affiches.map((d) => {
                  const etat = etatDuDevis(d, factureTireeDe(d.id, liens), aujourdHui)
                  const brouillon = d.statut === 'brouillon'
                  return (
                    <tr key={d.id}>
                      <td data-libelle="Numéro">{d.numero ?? 'Brouillon'}</td>
                      <td data-libelle="Date">{formatDate(d.date_emission)}</td>
                      <td data-libelle="Client"><div className="nom-fichier">{d.tiers_nom}</div></td>
                      <td data-libelle="Montant TTC">{formatMoney(d.montant_ttc)}</td>
                      <td data-libelle="État">
                        <span className={`badge badge-une-ligne ${CLASSE_ETAT[etat]}`}>{LIBELLES_ETAT_DEVIS[etat]}</span>
                      </td>
                      {peutEcrire && (
                        <td className="td-actions">
                          {brouillon && (
                            <>
                              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => ouvrir(d)}>Modifier</button>
                              <button type="button" className="btn btn-danger btn-sm" disabled={occupe} onClick={() => supprimer(d)}>
                                Supprimer le brouillon
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {fenetre && peutEcrire && (
        <DevisSaisieModal
          key={fenetre.devis?.id ?? 'nouveau'}
          espace={espace}
          dossierId={dossierId}
          statutTva={statutTva}
          cible={fenetre.devis ? { nouveau: false, devis: fenetre.devis } : { nouveau: true }}
          depart={saisieDuDevis(fenetre.devis, defauts)}
          lignesDeDepart={lignesSaisiesDuDevis(fenetre.devis, statutTva)}
          aujourdHui={aujourdHui}
          occupe={occupe}
          erreur={erreurFenetre}
          onClose={() => setFenetre(null)}
          onEnregistrer={(saisie, emettre) => enregistrer(saisie, emettre, fenetre.devis)}
        />
      )}
    </>
  )
}
