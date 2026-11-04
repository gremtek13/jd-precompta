import { useEffect, useRef, useState } from 'react'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import { aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import { pourLEspace, type EspaceVentes } from '../../lib/espaceVentes'
import {
  LIBELLES_ETAT_DEVIS, avisDeLApercuDuDevis, ceQueLeDevisImprime, champsDeRechercheDuDevis, confirmationDeLaFacturation, confirmationDeLaReponse, confirmationDeLEmission,
  confirmationDeLaSuppressionDevis, decisionDeLaSaisie, ecritureDuDevis, etatDuDevis, factureDuDevis, factureTireeDe,
  libelleDeLaFactureTiree, lignesSaisiesDuDevis, refusDeLaReponse, refusDeLaSaisieDevis, refusFacturationDevis, refusSuppressionDevis,
  saisieDuDevis, type CibleDevis, type EmissionAJuger, type EtatDevis, type SaisieDevis, type SaisieReponseDevis,
} from '../../lib/devis'
import { lireLesDevis, type LectureDesDevis } from '../../lib/devisLecture'
import { deciderDevis, enregistrerDevis, facturerDevis, supprimerBrouillonDevis } from '../../lib/devisEcriture'
import type { ArticleExoneration, Devis, StatutTva } from '../../lib/types'
import DevisApercu from './DevisApercu'
import DevisReponseModal from './DevisReponseModal'
import DevisSaisieModal from './DevisSaisieModal'

// « DEVIS » (espace client, étape P6a1 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU
// CLIENT : LA CONCEPTION », §2.3 et §4.3) : la liste des devis du dossier et les gestes d'un brouillon — créer, modifier,
// émettre, supprimer. La vue « Devis » de l'onglet Factures, au cabinet dans l'onglet, au client « Ventes » dans « Mes
// ventes », offerte seulement quand les migrations des devis sont en base (`DEVIS_EXPORTES`, FacturesTab). Puis (étape P6a2) :
// répondre à un devis émis (`decider_devis`), transformer un devis accepté en facture (`facturer_devis`) — l'onglet ouvre alors
// le brouillon tiré (`onOuvrirFacture`) —, la facture tirée dite dans la liste, et une recherche qui ne filtre que l'affichage.
// Puis (étape P6b) : l'aperçu imprimable de chaque devis (DevisApercu, `ceQueLeDevisImprime`), offert sur une liste lue en
// entier comme tout le reste — lue en partie, l'état qu'il dirait pourrait être faux. L'e-mail vient ensuite.
//
// QUI ÉCRIT : le cabinet ET le client « Ventes », par les mêmes fonctions (`enregistrer_devis`, `supprimer_brouillon_devis`,
// `decider_devis`, `facturer_devis`) ;
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
  // Le dossier, tel que l'onglet le lit ; l'émetteur d'un devis, la base le pose à l'émission (lu avec les devis).
  dossierNom: string
  dossierSiret: string | null
  dossierAdresse: string | null
  statutTva: StatutTva | null
  articleExoneration: ArticleExoneration | null
  // Avec le statut de TVA, décide du numéro de TVA que l'aperçu imprime sous l'émetteur, comme sur une facture.
  numeroTvaAttribue: boolean
  // Mène au brouillon de facture tiré d'un devis, par le chemin que l'onglet Factures offre pour ouvrir une facture.
  onOuvrirFacture: (factureId: string) => void
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
  // Le devis auquel on répond, tel que la liste l'a lu.
  const [reponseA, setReponseA] = useState<Devis | null>(null)
  // Le devis dont l'aperçu est ouvert, par son identifiant : l'aperçu montre la ligne telle que la dernière lecture l'a rendue.
  const [apercuDe, setApercuDe] = useState<string | null>(null)
  const [recherche, setRecherche] = useState('')
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

  const { devis, liens, factures, complete, motif } = courante
  // Aucun geste ne part d'une liste lue en partie.
  const peutEcrire = complete
  // L'émetteur que la base lira, lu avec les devis (une lecture complète le porte), et qui émet : le cabinet du dossier
  // (`admin_du_dossier`), ou un accès « Ventes ».
  const emission: EmissionAJuger | null = lecture?.etat === 'lue' && lecture.complete && lecture.emetteur
    ? { dossier: lecture.emetteur, cabinet: espace === 'cabinet' } : null
  // Le plus récent d'abord : la date du devis, puis sa création.
  const tries = [...devis].sort((a, b) =>
    b.date_emission.localeCompare(a.date_emission) || b.cree_le.localeCompare(a.cree_le) || b.id.localeCompare(a.id))
  // Chaque devis avec son état et la facture tirée de lui (la première, comme la base la nomme).
  const lignes = tries.map((d) => ({
    d, facture: factureDuDevis(d.id, liens, factures), etat: etatDuDevis(d, factureTireeDe(d.id, liens), aujourdHui),
  }))
  // La recherche ne filtre que l'AFFICHAGE : le compte de la barre et tout jugement lisent la liste entière.
  // L'aperçu ouvert, sur la liste ENTIÈRE (une recherche ne le ferme pas) ; un devis disparu de la relecture le ferme.
  const apercu = apercuDe === null ? null : lignes.find(({ d }) => d.id === apercuDe) ?? null
  const affiches = lignes.filter(({ d, etat, facture }) =>
    correspondALaRecherche(champsDeRechercheDuDevis(d, etat, facture), recherche))

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
    if (!emission) return
    const refus = refusDeLaSaisieDevis(dossierId, cible, saisie, emettre, aujourdHui, emission)
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

  async function repondre(d: Devis, saisie: SaisieReponseDevis) {
    if (gesteEnCours.current) return
    // Seconde ceinture : le bouton est déjà grisé sous ce refus.
    const refus = refusDeLaReponse(dossierId, d, saisie, aujourdHui)
    if (refus || saisie.reponse === '') {
      if (refus) setErreurFenetre(dire(refus))
      return
    }
    const reponse = saisie.reponse
    if (!window.confirm(dire(confirmationDeLaReponse(d, { ...saisie, reponse })))) return
    // `p_hors_validite` part à vrai pour une acceptation datée après la validité, que la confirmation a dite — là seulement.
    const { horsValidite } = decisionDeLaSaisie(d, saisie)
    const fait = await sousVerrou('La réponse au devis n’a pas pu être enregistrée.', async () => {
      await deciderDevis(dossierId, d.id, reponse, saisie.dateReponse, horsValidite)
      return `Réponse au devis ${d.numero ?? ''} enregistrée : ${reponse === 'acceptee' ? 'accepté' : 'refusé'} le `
        + `${formatDate(saisie.dateReponse)}.`
    }, setErreurFenetre)
    if (fait) setReponseA(null)
  }

  async function transformer(d: Devis, facture: { numero: string | null } | null) {
    if (gesteEnCours.current) return
    const refus = refusFacturationDevis(dossierId, d, facture)
    if (refus) {
      setErreur(dire(refus.message))
      return
    }
    if (!window.confirm(dire(confirmationDeLaFacturation(d, aujourdHui)))) return
    const tiree: { factureId: string | null } = { factureId: null }
    const fait = await sousVerrou('Le devis n’a pas pu être transformé en facture.', async () => {
      tiree.factureId = await facturerDevis(dossierId, d.id)
      return `Brouillon de facture tiré du devis ${d.numero ?? ''}.`
    }, setErreur)
    // Relue, la liste dit le devis facturé ; puis le brouillon s'ouvre, par le chemin de l'onglet — sous le même dossier.
    if (fait && tiree.factureId != null && dossierAffiche.current === dossierId) props.onOuvrirFacture(tiree.factureId)
  }

  function ouvrir(d: Devis | null) {
    setErreur(null)
    setErreurFenetre(null)
    setMessage(null)
    setFenetre({ devis: d })
  }

  function ouvrirLaReponse(d: Devis) {
    setErreur(null)
    setErreurFenetre(null)
    setMessage(null)
    setReponseA(d)
  }

  const defauts = { aujourdHui, statutTva, articleExoneration }

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

      {lignes.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <BarreRecherche
            valeur={recherche}
            onChange={setRecherche}
            placeholder="Rechercher un numéro, un client, un montant…"
            affiches={affiches.length}
            total={lignes.length}
          />
        </div>
      )}

      {erreur && <p className="error-text" role="alert">{erreur}</p>}
      {message && <p className="muted" role="status">{message}</p>}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {affiches.length === 0 ? (
          <div className="empty-state">
            {lignes.length > 0 ? 'Aucun devis ne correspond à la recherche.'
              : !complete ? 'La liste des devis n’a pas pu être lue en entier.'
                : espace === 'client' ? 'Tu n’as encore aucun devis.' : 'Aucun devis pour ce dossier.'}
          </div>
        ) : (
          <div className="tableau-adaptable">
            <table className="table-empilable table-empilable-en-carte" aria-label="Devis">
              <thead>
                <tr>
                  <th>Numéro</th><th>Date</th><th>Client</th><th>Montant TTC</th><th>État</th><th>Facture</th>
                  {peutEcrire && <th></th>}
                </tr>
              </thead>
              <tbody>
                {affiches.map(({ d, etat, facture }) => {
                  const brouillon = d.statut === 'brouillon'
                  const sansReponse = etat === 'en_attente' || etat === 'expire'
                  return (
                    <tr key={d.id}>
                      <td data-libelle="Numéro">{d.numero ?? 'Brouillon'}</td>
                      <td data-libelle="Date">{formatDate(d.date_emission)}</td>
                      <td data-libelle="Client"><div className="nom-fichier">{d.tiers_nom}</div></td>
                      <td data-libelle="Montant TTC">{formatMoney(d.montant_ttc)}</td>
                      <td data-libelle="État">
                        <span className={`badge badge-une-ligne ${CLASSE_ETAT[etat]}`}>{LIBELLES_ETAT_DEVIS[etat]}</span>
                      </td>
                      <td data-libelle="Facture">{facture ? libelleDeLaFactureTiree(facture) : '—'}</td>
                      {peutEcrire && (
                        <td className="td-actions">
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setApercuDe(d.id)}>Aperçu</button>
                          {brouillon && (
                            <>
                              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => ouvrir(d)}>Modifier</button>
                              <button type="button" className="btn btn-danger btn-sm" disabled={occupe} onClick={() => supprimer(d)}>
                                Supprimer le brouillon
                              </button>
                            </>
                          )}
                          {sansReponse && (
                            <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => ouvrirLaReponse(d)}>
                              Enregistrer la réponse
                            </button>
                          )}
                          {etat === 'accepte' && (
                            <button type="button" className="btn btn-primary btn-sm" disabled={occupe} onClick={() => transformer(d, facture)}>
                              Transformer en facture
                            </button>
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

      {fenetre && peutEcrire && emission && (
        <DevisSaisieModal
          key={fenetre.devis?.id ?? 'nouveau'}
          espace={espace}
          dossierId={dossierId}
          statutTva={statutTva}
          cible={fenetre.devis ? { nouveau: false, devis: fenetre.devis } : { nouveau: true }}
          depart={saisieDuDevis(fenetre.devis, defauts)}
          lignesDeDepart={lignesSaisiesDuDevis(fenetre.devis, statutTva)}
          aujourdHui={aujourdHui}
          emission={emission}
          occupe={occupe}
          erreur={erreurFenetre}
          onClose={() => setFenetre(null)}
          onEnregistrer={(saisie, emettre) => enregistrer(saisie, emettre, fenetre.devis)}
        />
      )}

      {apercu && peutEcrire && (
        <DevisApercu
          key={apercu.d.id}
          espace={espace}
          apercu={ceQueLeDevisImprime(apercu.d, courante.emetteur, {
            statut_tva: statutTva, article_exoneration: articleExoneration, numero_tva_attribue: props.numeroTvaAttribue,
          })}
          avis={avisDeLApercuDuDevis(apercu.d, apercu.etat)}
          onClose={() => setApercuDe(null)}
        />
      )}

      {reponseA && peutEcrire && (
        <DevisReponseModal
          key={reponseA.id}
          espace={espace}
          dossierId={dossierId}
          devis={reponseA}
          aujourdHui={aujourdHui}
          occupe={occupe}
          erreur={erreurFenetre}
          onClose={() => setReponseA(null)}
          onRepondre={(saisie) => repondre(reponseA, saisie)}
        />
      )}
    </>
  )
}
