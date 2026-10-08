import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, formatDate, formatMoney } from '../../lib/format'
import type { ArticleExoneration, FactureEmise, StatutTva, TransmissionFacture } from '../../lib/types'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import FactureFormModal from './FactureFormModal'
import FactureAvoirModal from './FactureAvoirModal'
import FactureApercu from './FactureApercu'
import TransmissionFactureModal from './TransmissionFactureModal'
import { badgeClasseStatutSuperpdp, libelleStatutSuperpdp } from '../../lib/superpdpStatuts'
import { ETATS_TRANSMISSION, libelleCourtCanal, transmissionCourante } from '../../lib/transmissionsFactures'
import EnvoyerEmailModal from '../../components/EnvoyerEmailModal'
import { lireTout } from '../../lib/lectureComplete'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { messageErreur } from '../../lib/messageErreur'
import { dejaCredite } from '../../lib/factures'

interface Props {
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
  onAdresseUpdated: (adresse: string) => void
}

// Facturation du dossier — émet soi-même des factures conformes, en complément de la réception déjà
// en place (Super PDP, voir SuperPdpModal). Une facture validée peut être transmise par une plateforme
// agréée — celle du client ou Super PDP (voir TransmissionFactureModal) — ou, comme avant, simplement
// imprimée/exportée en PDF pour être envoyée manuellement : la transmission électronique n'est jamais
// obligatoire ici (un client particulier, une plateforme pas encore reliée).
export default function FacturesTab({ dossierId, dossierNom, dossierSiret, dossierAdresse, statutTva, articleExoneration, numeroTvaAttribue, tvaSurDebits, onAdresseUpdated }: Props) {
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
  const [erreur, setErreur] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    // La suite des factures émises est LÉGALE : elle n'admet ni trou ni doublon, et une liste
    // tronquée ferait croire à un trou là où il n'y en a pas. Tri TOTAL, `date_emission` n'étant
    // pas unique — plusieurs factures partent le même jour.
    const lecture = await lireTout<FactureEmise>((debut, fin) =>
      supabase.from('factures_emises').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('date_emission', { ascending: false }).order('id').range(debut, fin),
    )
    // Tri TOTAL, la clé primaire en dernier : deux envois d'une même seconde se lisent toujours dans le même ordre.
    const envois = await lireTout<TransmissionFacture>((debut, fin) =>
      supabase.from('transmissions_factures')
        .select('id, dossier_id, facture_id, canal, hote, flux_id, sha256, etat, detail, cree_le, maj_le', { count: 'exact' })
        .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
    )
    setFactures(lecture.lignes)
    setLectureIncomplete(lecture.complete ? null : lecture.motif)
    setTransmissions(envois.lignes)
    setTransmissionsIncompletes(envois.complete ? null : envois.motif)
    setLoading(false)
  }
  useEffect(() => { load() }, [dossierId])

  const anneesDisponibles = [...new Set(factures.map((f) => anneeDe(f.date_emission)))].sort((a, b) => b - a)
  const avantRecherche = factures.filter((f) => anneeFilter === 'toutes' || anneeDe(f.date_emission) === anneeFilter)
  const filtered = avantRecherche.filter((f) =>
    correspondALaRecherche([f.numero, f.tiers_nom, f.statut, f.date_emission, formatDate(f.date_emission), f.montant_ttc], recherche),
  )

  // Le résultat de la suppression est LU : le `load()` qui suit fait bien réapparaître un brouillon
  // refusé, mais sans un mot, sur un geste que l'opérateur vient de CONFIRMER — le réflexe est alors
  // de reconfirmer, et d'obtenir le même silence (le défaut de `SuperPdpModal.retirer`, corrigé de
  // même sur `SupplementsTab` et `AccesTab`).
  async function supprimer(f: FactureEmise) {
    if (!window.confirm(`Supprimer le brouillon de facture pour "${f.tiers_nom}" ? Cette action est irréversible.`)) return
    setErreur(null)
    const { error: suppressionError } = await supabase.from('factures_emises').delete().eq('id', f.id)
    if (suppressionError) setErreur(messageErreur(suppressionError, 'Le brouillon n’a pas pu être supprimé.'))
    load()
  }

  // La facture qu'on transmet, telle que la liste l'a relue en dernier.
  const transmise = transmissionDe ? factures.find((f) => f.id === transmissionDe) ?? null : null

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
          'Une facture peut paraître jamais transmise alors qu’elle l’a été. La fenêtre « Transmettre » relit celles de sa '
          + 'facture avant de proposer un envoi.'
        }
      />
      <p className="muted" style={{ marginTop: -8, marginBottom: 4 }}>
        Une facture validée reçoit un numéro définitif et n'est plus modifiable — corrige une erreur
        par une facture d'avoir plutôt qu'en la rouvrant.
      </p>
      <details className="muted" style={{ marginBottom: 20 }}>
        <summary style={{ cursor: 'pointer' }}>En savoir plus</summary>
        <p style={{ marginTop: 6, marginBottom: 0 }}>
          Le bouton "Avoir" sur une ligne crée un avoir avec sa propre numérotation (série "A",
          indépendante des factures), qui référence toujours la facture corrigée. Une fois validée,
          une facture peut être transmise par une plateforme agréée — celle du client, reliée dans
          l'onglet Justificatifs, ou Super PDP — ou envoyée par e-mail ; imprimer/enregistrer en PDF
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

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>+ Nouvelle facture</button>
      </div>

      {erreur && <p className="error-text">{erreur}</p>}

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
              : lectureIncomplete ? 'La liste des factures n’a pas pu être lue.' : 'Aucune facture.'}
          </div>
        ) : (
          <table>
            <thead>
              <tr><th>Numéro</th><th>Date</th><th>Client</th><th>Montant TTC</th><th>Statut</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const origine = f.facture_origine_id ? factures.find((o) => o.id === f.facture_origine_id) : null
                return (
                  <tr key={f.id} className="clickable" onClick={() => ouvrir(f)}>
                    <td>
                      {f.numero ?? '—'}
                      {f.type === 'avoir' && (
                        <>
                          {' '}<span className="badge badge-neutral">Avoir</span>
                          <div className="muted" style={{ fontSize: '0.78rem' }}>→ {origine?.numero ?? f.facture_origine_id?.slice(0, 8)}</div>
                        </>
                      )}
                    </td>
                    <td>{formatDate(f.date_emission)}</td>
                    <td>{f.tiers_nom}</td>
                    <td>{formatMoney(f.montant_ttc)}</td>
                    <td>
                      {f.statut === 'validee'
                        ? <span className="badge badge-ok">Validée</span>
                        : <span className="badge badge-warning">Brouillon</span>}
                      {f.statut === 'validee' && (() => {
                        const courante = transmissionCourante(transmissions, f.id)
                        // Partie par Super PDP, la facture a un cycle de vie que Super PDP rend (reçue, refusée par
                        // l'acheteur, encaissée…) : il en dit plus que l'état de sa transmission.
                        if (courante?.canal === 'superpdp' && f.superpdp_dernier_statut) {
                          return (
                            <div style={{ marginTop: 4 }}>
                              <span className={`badge ${badgeClasseStatutSuperpdp(f.superpdp_dernier_statut)}`}>
                                Super PDP · {libelleStatutSuperpdp(f.superpdp_dernier_statut)}
                              </span>
                            </div>
                          )
                        }
                        if (courante) {
                          return (
                            <div style={{ marginTop: 4 }}>
                              <span className={`badge ${ETATS_TRANSMISSION[courante.etat].badge}`}>
                                {libelleCourtCanal(courante)} · {ETATS_TRANSMISSION[courante.etat].libelle}
                              </span>
                            </div>
                          )
                        }
                        // Partie par Super PDP avant que chaque envoi laisse sa transmission.
                        return f.superpdp_invoice_id ? (
                          <div style={{ marginTop: 4 }}>
                            <span className={`badge ${badgeClasseStatutSuperpdp(f.superpdp_dernier_statut)}`}>
                              Super PDP · {f.superpdp_dernier_statut ? libelleStatutSuperpdp(f.superpdp_dernier_statut) : '…'}
                            </span>
                          </div>
                        ) : null
                      })()}
                    </td>
                    <td className="td-actions" onClick={(e) => e.stopPropagation()}>
                      {f.statut === 'brouillon' && (
                        <button className="btn btn-danger btn-sm" onClick={() => supprimer(f)}>Supprimer</button>
                      )}
                      {f.statut === 'validee' && (
                        <button className="btn btn-outline btn-sm" onClick={() => setApercu(f)}>Aperçu</button>
                      )}
                      {f.statut === 'validee' && f.type === 'facture' && (
                        <button className="btn btn-outline btn-sm" onClick={() => setAvoirDe(f)}>Avoir</button>
                      )}
                      {f.statut === 'validee' && (
                        <button className="btn btn-outline btn-sm" onClick={() => setTransmissionDe(f.id)}>Transmettre</button>
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
        )}
      </div>

      {editing && (
        <FactureFormModal
          dossierId={dossierId}
          dossierNom={dossierNom}
          dossierSiret={dossierSiret}
          dossierAdresse={dossierAdresse}
          statutTva={statutTva}
          articleExoneration={articleExoneration}
          numeroTvaAttribue={numeroTvaAttribue}
          tvaSurDebits={tvaSurDebits}
          facture={editing === 'new' ? null : editing}
          onAdresseUpdated={onAdresseUpdated}
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
          facture={transmise}
          statutTva={statutTva}
          articleExoneration={articleExoneration}
          numeroTvaAttribue={numeroTvaAttribue}
          onClose={() => setTransmissionDe(null)}
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
