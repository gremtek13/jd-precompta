import { useEffect, useState } from 'react'
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
    // Les lignes de TOUTES les factures du dossier — par leur facture, la table n'ayant pas de dossier —, ses
    // encaissements et leurs parts, retirés compris : `resteAEncaisser` décide lui-même de ce qui compte. Puis les
    // déclarations du dossier, échouées et rejetées comprises, et l'historique de Super PDP de ses factures (par leur
    // facture, comme les lignes) : `pastilleDeclaration` décide lui-même de ce qui est déclaré, et de ce qui ne le sera pas.
    const [lignes, encaisses, parts, declares, evenements] = await Promise.all([
      lireTout<LigneDeFacture & { id: string }>((debut, fin) =>
        supabase.from('facture_lignes')
          .select('id, facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, factures_emises!inner(dossier_id)', { count: 'exact' })
          .eq('factures_emises.dossier_id', dossierId).order('facture_id').order('ordre').order('id').range(debut, fin),
      ),
      lireTout<EncaissementPourContrePassation>((debut, fin) =>
        supabase.from('encaissements_factures')
          .select('id, dossier_id, facture_id, date_encaissement, montant, ligne_bancaire_id, annule_id, retire_le', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<PartLue>((debut, fin) =>
        supabase.from('encaissements_factures_taux').select('encaissement_id, taux, montant', { count: 'exact' })
          .eq('dossier_id', dossierId).order('encaissement_id').order('taux').range(debut, fin),
      ),
      lireTout<DeclarationLue>((debut, fin) =>
        supabase.from('transmissions_encaissements')
          .select('id, dossier_id, encaissement_id, facture_id, canal, hote, etat', { count: 'exact' })
          .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
      ),
      lireTout<EvenementSuperpdpLu & { id: string }>((debut, fin) =>
        supabase.from('facture_superpdp_events')
          .select('id, facture_id, status_code, factures_emises!inner(dossier_id)', { count: 'exact' })
          .eq('factures_emises.dossier_id', dossierId).order('facture_id').order('occurred_at').order('id').range(debut, fin),
      ),
    ])
    setFactures(lecture.lignes)
    setLectureIncomplete(lecture.complete ? null : lecture.motif)
    setTransmissions(envois.lignes)
    setTransmissionsIncompletes(envois.complete ? null : envois.motif)
    setLignesFactures(lignes.lignes)
    setEncaissements(encaisses.lignes)
    setPartsEncaissements(parts.lignes)
    setEncaissementsIncomplets(
      !lignes.complete ? lignes.motif : !encaisses.complete ? encaisses.motif : !parts.complete ? parts.motif : null,
    )
    setDeclarations(declares.lignes)
    setEvenementsSuperpdp(evenements.lignes)
    setDeclarationsIncompletes(!declares.complete ? declares.motif : !evenements.complete ? evenements.motif : null)
    setLoading(false)
  }
  useEffect(() => { load() }, [dossierId])

  // Le jour à Paris, lu au rendu : une déclaration en retard l'est au jour de la base, pas à celui du chargement.
  const aujourdHui = aujourdHuiAParis()
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
                                  {libelleCourtCanal(courante)} · {ETATS_TRANSMISSION[courante.etat].libelle}
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
                          {/* Rien sur une lecture incomplète : « À encaisser » serait une affirmation que la liste ne
                              permet pas. Rien non plus quand le statut « Encaissée » est sans objet pour cette facture. */}
                          {encaissementsIncomplets == null && (() => {
                            const pastille = pastilleEncaissement(f, lignesFactures, encaissements, partsEncaissements, statutTva)
                            return pastille ? <span className={`badge badge-une-ligne ${pastille.classe}`}>{pastille.libelle}</span> : null
                          })()}
                          {/* Ce qui reste à DÉCLARER, une seconde pastille : un fait (l'encaissement) et une obligation (sa
                              déclaration) ne partagent pas une couleur. Rien si une seule des listes dont elle dépend est
                              incomplète. */}
                          {encaissementsIncomplets == null && declarationsIncompletes == null && transmissionsIncompletes == null && (() => {
                            const pastille = pastilleDeclaration(
                              dossierId, f, lignesFactures, encaissements, declarations, transmissions, evenementsSuperpdp, statutTva,
                              aujourdHui,
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
                          <button className="btn btn-outline btn-sm" onClick={() => setAvoirDe(f)}>Avoir</button>
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

      {encaissee && (
        <EncaissementsFactureModal
          key={encaissee.id}
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
