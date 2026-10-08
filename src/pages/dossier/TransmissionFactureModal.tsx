import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { aujourdHuiSql, dateRelative, formatDate } from '../../lib/format'
import { donneesDeLaFacture, refusEmission, type LigneCii, type OrigineCii } from '../../lib/factureCii'
import { appelerPlateforme, lireConnexionPlateforme, type ConnexionPlateformeVue } from '../../lib/receptionPlateforme'
import { lireTout } from '../../lib/lectureComplete'
import { extraireErreurFonction } from '../../lib/invokeErreur'
import { messageErreur } from '../../lib/messageErreur'
import { badgeClasseStatutSuperpdp, libelleStatutSuperpdp } from '../../lib/superpdpStatuts'
import { ETATS_TRANSMISSION, abandonnable, estActive, libelleCanal, transmissionsDe } from '../../lib/transmissionsFactures'
import type { ArticleExoneration, FactureEmise, FactureSuperpdpEvent, StatutTva, TransmissionFacture } from '../../lib/types'

interface Props {
  dossierId: string
  facture: FactureEmise
  // Le statut de TVA du dossier aujourd'hui : la facture ne le fige pas, et les fonctions qui la transmettent le relisent.
  statutTva: StatutTva | null
  articleExoneration: ArticleExoneration | null
  onClose: () => void
  // La liste des factures se relit : l'état de leurs transmissions, et le numéro qu'a rendu Super PDP.
  onUpdated: () => void
}

const COLONNES_TRANSMISSION = 'id, dossier_id, facture_id, canal, hote, flux_id, sha256, etat, detail, cree_le, maj_le'

// LA TRANSMISSION D'UNE FACTURE VALIDÉE (ligne 28.5, étape c4) : par la plateforme agréée du client, que la connexion
// de l'onglet Justificatifs désigne (plateforme-agreee, « déposer » puis « suivre »), ou par Super PDP (superpdp-emit,
// « envoyer » puis « actualiser »). Les deux transmettent le même fichier, le CII que l'application écrit, et chacune
// RÉSERVE sa transmission avant de partir : la base n'en admet qu'une active par facture, tous canaux confondus.
//
// CE QUI L'EMPÊCHE DE PARTIR SE DIT AVANT LE CLIC, avec le jugement même des fonctions (`refusEmission`, sur la facture
// assemblée par `donneesDeLaFacture`) ; elles le refont de leur côté, sur la facture relue en base. Et rien n'est
// proposé tant qu'on ne SAIT pas si elle est déjà partie : ses transmissions lues en entier, sinon aucun bouton.
export default function TransmissionFactureModal({ dossierId, facture, statutTva, articleExoneration, onClose, onUpdated }: Props) {
  const [lignes, setLignes] = useState<LigneCii[] | null>(null)
  // Pour un avoir : la facture qu'il corrige, dont il transmet le numéro et la date. `undefined` tant qu'elle n'est pas lue ;
  // nulle pour une facture, et pour un avoir qui n'en cite aucune — `refusEmission` le dit alors.
  const [origine, setOrigine] = useState<OrigineCii | null | undefined>(
    facture.type === 'avoir' && facture.facture_origine_id ? undefined : null,
  )
  const [transmissions, setTransmissions] = useState<TransmissionFacture[] | null>(null)
  // L'instant de leur lecture : l'abandon se juge sur lui, la liste qu'on voit étant celle de cet instant.
  const [luesA, setLuesA] = useState(0)
  const [lectureRatee, setLectureRatee] = useState<string | null>(null)
  // `undefined` : pas encore lue ; `null` : aucune plateforme reliée au dossier.
  const [connexion, setConnexion] = useState<ConnexionPlateformeVue | null | undefined>(undefined)
  const [connexionErreur, setConnexionErreur] = useState<string | null>(null)
  const [superpdp, setSuperpdp] = useState<boolean | undefined>(undefined)
  const [superpdpErreur, setSuperpdpErreur] = useState<string | null>(null)
  const [evenements, setEvenements] = useState<FactureSuperpdpEvent[] | null>(null)
  const [evenementsErreur, setEvenementsErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Ses transmissions, lues EN ENTIER : une liste tronquée ne dirait pas si la facture est déjà partie.
  async function lireTransmissions() {
    const lecture = await lireTout<TransmissionFacture>((debut, fin) =>
      supabase.from('transmissions_factures').select(COLONNES_TRANSMISSION, { count: 'exact' })
        .eq('facture_id', facture.id).order('cree_le').order('id').range(debut, fin),
    )
    setTransmissions(lecture.complete ? lecture.lignes : null)
    setLuesA(Date.now())
    setLectureRatee(lecture.complete ? null : lecture.motif)
  }

  async function lireEvenements() {
    const { data, error } = await supabase.from('facture_superpdp_events').select('*')
      .eq('facture_id', facture.id).order('occurred_at', { ascending: true })
    setEvenementsErreur(error ? messageErreur(error, "L'historique de Super PDP n'a pas pu être lu.") : null)
    setEvenements(error ? null : (data ?? []) as FactureSuperpdpEvent[])
  }

  async function lireCanaux() {
    const [plateforme, statutSuperpdp] = await Promise.all([
      lireConnexionPlateforme(dossierId),
      supabase.functions.invoke<{ configured?: boolean }>('superpdp-credentials', { body: { dossierId, action: 'status' } }),
    ])
    setConnexion(plateforme.erreur === null ? plateforme.donnees.connexion : undefined)
    setConnexionErreur(plateforme.erreur)
    if (statutSuperpdp.error || !statutSuperpdp.data) {
      setSuperpdp(undefined)
      setSuperpdpErreur(await extraireErreurFonction(statutSuperpdp.error, 'La configuration de Super PDP n’a pas pu être lue.'))
    } else {
      setSuperpdp(statutSuperpdp.data.configured === true)
      setSuperpdpErreur(null)
    }
  }

  useEffect(() => {
    supabase.from('facture_lignes').select('ordre, designation, quantite, prix_unitaire_ht, taux_tva')
      .eq('facture_id', facture.id).order('ordre')
      .then(({ data, error }) => {
        if (error) setLectureRatee(messageErreur(error, 'Les lignes de la facture n’ont pas pu être lues.'))
        else setLignes((data ?? []) as LigneCii[])
      })
    if (facture.type === 'avoir' && facture.facture_origine_id) {
      supabase.from('factures_emises').select('numero, date_emission').eq('id', facture.facture_origine_id).maybeSingle()
        .then(({ data, error }) => {
          if (error) setLectureRatee(messageErreur(error, 'La facture que l’avoir corrige n’a pas pu être lue.'))
          else setOrigine(data ? { numero: data.numero, date_emission: data.date_emission } : null)
        })
    }
    lireTransmissions()
    lireCanaux()
    // L'historique de Super PDP se lit toujours : la facture peut y être partie sans en porter le numéro, que sa
    // transmission a gardé si son écriture a échoué après l'envoi. Il ne s'affiche que pour une facture partie par lui.
    lireEvenements()
  }, [facture.id])

  // UN SEUL VERROU pour toutes les actions de la fenêtre, posé avant le `try` et relâché dans le `finally`, APRÈS la
  // relecture : un clic pendant qu'elle court repartirait d'un état qu'on n'a pas encore vu. Le doublon, ici, sort de
  // l'application : une facture transmise deux fois à une plateforme agréée ne se reprend pas.
  const appelEnCours = useRef(false)

  async function agir(action: string, appel: () => Promise<void>) {
    if (appelEnCours.current) return
    appelEnCours.current = true
    setEnCours(action)
    setErreur(null)
    setMessage(null)
    try {
      await appel()
    } catch (err) {
      setErreur(messageErreur(err, 'L’appel a échoué.'))
    } finally {
      setEnCours(null)
      appelEnCours.current = false
    }
  }

  const nature = facture.type === 'avoir' ? 'l’avoir' : 'la facture'
  const confirmer = (canal: string) => window.confirm(
    `Transmettre ${nature} ${facture.numero ?? ''} à ${facture.tiers_nom} par ${canal} ?\n\n`
    + 'Une facture transmise ne se reprend pas : seul un avoir la corrige.',
  )

  function deposer() {
    const c = connexion
    if (appelEnCours.current || !c || !confirmer(c.nom)) return
    agir('deposer', async () => {
      const r = await appelerPlateforme<{ transmission: TransmissionFacture }>(
        { action: 'deposer', dossierId, factureId: facture.id, version: c.version },
        'Le dépôt de la facture a échoué.',
      )
      if (r.erreur !== null) {
        setErreur(r.erreur)
        // La connexion a changé depuis l'ouverture : on relit celle d'aujourd'hui, et rien ne part sans un nouveau clic.
        if (r.drapeaux.perimee) await lireCanaux()
      } else {
        setMessage(`${ETATS_TRANSMISSION[r.donnees.transmission.etat].libelle} sur ${c.nom}.`)
      }
      // Dans tous les cas : un refus, une issue inconnue laissent aussi leur transmission.
      await lireTransmissions()
      onUpdated()
    })
  }

  function envoyerSuperPdp() {
    if (appelEnCours.current || !confirmer('Super PDP')) return
    agir('envoyer', async () => {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('superpdp-emit', {
        body: { dossierId, factureId: facture.id, action: 'envoyer' },
      })
      if (data?.error || error) setErreur(data?.error ?? await extraireErreurFonction(error, 'L’envoi par Super PDP a échoué.'))
      else setMessage('Envoyée par Super PDP.')
      await lireTransmissions()
      await lireEvenements()
      onUpdated()
    })
  }

  function suivre(t: TransmissionFacture) {
    agir(`suivre-${t.id}`, async () => {
      const r = await appelerPlateforme<{ transmission: TransmissionFacture; message?: string | null }>(
        { action: 'suivre', dossierId, transmissionId: t.id },
        'Le suivi de la facture a échoué.',
      )
      if (r.erreur !== null) setErreur(r.erreur)
      else setMessage(r.donnees.message ?? `${ETATS_TRANSMISSION[r.donnees.transmission.etat].libelle}.`)
      await lireTransmissions()
      onUpdated()
    })
  }

  // L'ABANDON D'UNE TRANSMISSION RESTÉE SANS ISSUE CONNUE (`abandonner_transmission`) : elle bloque tout nouvel envoi, et
  // seul le cabinet peut vérifier sur la plateforme que la facture n'y est pas. La confirmation dit quoi vérifier, et ce
  // que coûte une erreur : une facture reçue deux fois.
  function abandonner(t: TransmissionFacture) {
    if (appelEnCours.current) return
    const ou = t.canal === 'superpdp'
      ? `sur Super PDP que ${nature} ${facture.numero ?? ''} n’y est pas (elle y porterait l’identifiant externe ${facture.id})`
      : `sur la plateforme (${t.hote}) que ${nature} ${facture.numero ?? ''} n’y est pas`
    if (!window.confirm(`Abandonner cette transmission ? Vérifie d’abord ${ou}.\n\n`
      + 'Si elle y est et qu’elle repart, le client la recevra deux fois.')) return
    agir(`abandonner-${t.id}`, async () => {
      const { error } = await supabase.rpc('abandonner_transmission', { p_transmission_id: t.id })
      if (error) setErreur(messageErreur(error, 'La transmission n’a pas pu être abandonnée.'))
      else setMessage('Transmission abandonnée : la facture peut repartir.')
      await lireTransmissions()
      onUpdated()
    })
  }

  function actualiserSuperPdp() {
    agir('actualiser', async () => {
      const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('superpdp-emit', {
        body: { dossierId, factureId: facture.id, action: 'actualiser' },
      })
      if (data?.error || error) setErreur(data?.error ?? await extraireErreurFonction(error, 'Le statut de Super PDP n’a pas pu être relu.'))
      await lireEvenements()
      await lireTransmissions()
      onUpdated()
    })
  }

  const siennes = transmissions ? transmissionsDe(transmissions, facture.id) : null
  const active = siennes?.find(estActive) ?? null
  // Partie par Super PDP avant que chaque envoi laisse sa transmission : elle ne repart pas (les fonctions le refusent).
  const avantLesTransmissions = facture.superpdp_invoice_id != null && siennes != null && !siennes.some((t) => t.canal === 'superpdp')
  // Partie par Super PDP : par le numéro qu'elle porte, ou par celui que sa transmission a gardé si son écriture a
  // échoué après l'envoi — superpdp-emit le retrouve, et la suit de même.
  const chezSuperPdp = facture.superpdp_invoice_id != null || (siennes?.some((t) => t.canal === 'superpdp' && t.flux_id != null) ?? false)
  const refus = lignes != null && origine !== undefined
    ? refusEmission(donneesDeLaFacture(facture, lignes, { statut_tva: statutTva, article_exoneration: articleExoneration }, origine, aujourdHuiSql()))
    : null
  const peutPartir = siennes != null && active == null && !avantLesTransmissions && refus != null && refus.length === 0

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(640px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Transmettre {nature} {facture.numero}</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          À {facture.tiers_nom}, par une plateforme agréée : celle du client, que l’onglet Justificatifs relie au dossier,
          ou Super PDP. Une facture transmise ne se reprend pas : seul un avoir la corrige.
        </p>

        {lectureRatee ? (
          <p className="error-text">
            {lectureRatee} On ne sait donc pas si elle est déjà partie : rien n’est proposé. Rouvre cette fenêtre.
          </p>
        ) : siennes == null ? (
          <p className="muted">Chargement…</p>
        ) : (
          <>
            {active && (
              <p>
                <span className={`badge ${ETATS_TRANSMISSION[active.etat].badge}`}>{ETATS_TRANSMISSION[active.etat].libelle}</span>{' '}
                par {libelleCanal(active)}. {ETATS_TRANSMISSION[active.etat].explication}
                {active.etat === 'envoi' && (active.canal === 'plateforme'
                  ? ' « Suivre » la cherche sur la plateforme ; si elle ne la retrouve pas, elle s’abandonne un quart d’heure après son départ, vérification faite.'
                  : ' Super PDP ne se consulte pas d’ici : un quart d’heure après son départ, elle s’abandonne, vérification faite sur Super PDP.')}
              </p>
            )}
            {avantLesTransmissions && (
              <p>
                <span className="badge badge-warning">Transmise</span> par Super PDP, avant que l’application garde chaque
                transmission : elle ne repart pas.
              </p>
            )}

            {siennes.length > 0 && (
              <div className="field">
                <label>Transmissions</label>
                <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
                  <table>
                    <thead><tr><th>Date</th><th>Par</th><th>État</th><th>Détail</th><th></th></tr></thead>
                    <tbody>
                      {siennes.map((t) => (
                        <tr key={t.id}>
                          <td>{formatDate(t.cree_le)} <span className="muted">({dateRelative(t.cree_le)})</span></td>
                          <td>{libelleCanal(t)}</td>
                          <td><span className={`badge ${ETATS_TRANSMISSION[t.etat].badge}`}>{ETATS_TRANSMISSION[t.etat].libelle}</span></td>
                          <td className="muted" style={{ fontSize: '0.82rem' }}>{t.detail ?? '—'}</td>
                          <td>
                            {t.canal === 'plateforme' && (t.etat === 'envoi' || t.etat === 'depose') && (
                              <button type="button" className="btn btn-outline btn-sm" disabled={enCours != null} onClick={() => suivre(t)}>
                                {enCours === `suivre-${t.id}` ? 'Suivi…' : 'Suivre'}
                              </button>
                            )}
                            {abandonnable(t, luesA) && (
                              <button type="button" className="btn btn-outline btn-sm" disabled={enCours != null} onClick={() => abandonner(t)}>
                                {enCours === `abandonner-${t.id}` ? 'Abandon…' : 'Abandonner'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {chezSuperPdp && (
              <div className="field">
                <label>Historique chez Super PDP</label>
                {evenementsErreur ? (
                  <p className="error-text">
                    {evenementsErreur} On ne peut donc pas dire ce que Super PDP a renvoyé sur cette facture — ne pas en
                    conclure qu’il ne s’est rien passé.
                  </p>
                ) : evenements == null ? (
                  <p className="muted">Chargement…</p>
                ) : evenements.length === 0 ? (
                  <p className="muted">Aucun événement pour l’instant : actualise dans quelques instants.</p>
                ) : (
                  <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
                    <table>
                      <thead><tr><th>Date</th><th>Statut</th><th>Détail</th></tr></thead>
                      <tbody>
                        {[...evenements].reverse().map((e) => (
                          <tr key={e.id}>
                            <td>{formatDate(e.occurred_at)}</td>
                            <td><span className={`badge ${badgeClasseStatutSuperpdp(e.status_code)}`}>{libelleStatutSuperpdp(e.status_code)}</span></td>
                            <td className="muted" style={{ fontSize: '0.82rem' }}>{e.status_text}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {active == null && !avantLesTransmissions && refus != null && refus.length > 0 && (
              <div className="alerte-tva" style={{ marginTop: 8 }}>
                <strong>Elle ne peut pas partir telle quelle</strong> :
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {refus.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>
            )}

            {peutPartir && (
              <>
                {((connexion === undefined && connexionErreur == null) || (superpdp === undefined && superpdpErreur == null)) && (
                  <p className="muted">Lecture des plateformes reliées au dossier…</p>
                )}
                {connexion === null && superpdp === false && (
                  <p className="muted">
                    Aucune plateforme n’est reliée à ce dossier : relie celle du client dans l’onglet Justificatifs
                    (« Plateforme du client »), ou configure Super PDP.
                  </p>
                )}
                {connexionErreur && <p className="error-text">{connexionErreur}</p>}
                {superpdpErreur && <p className="error-text">{superpdpErreur}</p>}
              </>
            )}
          </>
        )}

        {message && <p className="muted" role="status">{message}</p>}
        {erreur && <p className="error-text">{erreur}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={enCours != null}>Fermer</button>
          {chezSuperPdp && (
            <button type="button" className="btn btn-outline" disabled={enCours != null} onClick={actualiserSuperPdp}>
              {enCours === 'actualiser' ? 'Actualisation…' : 'Actualiser le statut Super PDP'}
            </button>
          )}
          {peutPartir && superpdp === true && (
            <button type="button" className="btn btn-outline" disabled={enCours != null} onClick={envoyerSuperPdp}>
              {enCours === 'envoyer' ? 'Envoi…' : 'Envoyer par Super PDP'}
            </button>
          )}
          {peutPartir && connexion != null && (
            <button type="button" className="btn btn-primary" disabled={enCours != null} onClick={deposer}>
              {enCours === 'deposer' ? 'Dépôt…' : `Déposer sur ${connexion.nom}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
