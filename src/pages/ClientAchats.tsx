import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { messageErreur } from '../lib/messageErreur'
import { aujourdHuiAParis, formatDate, formatMoney } from '../lib/format'
import { pourLEspace } from '../lib/espaceVentes'
import {
  echeanceLueSurLaFacture, LIBELLES_DES_MOYENS, MOYENS_DECLARES, refusDeLaDeclaration, refusDeLEcheance, type PaiementDeclare,
} from '../lib/achatsClient'
import {
  achatsDits, confirmationDuRetraitAuClient, declarationDiteAuClient, lotsDeVues, montantSaisi, moyenSaisi, MOTS_DE_L_ECHEANCE,
  origineDeLEcheanceAuClient, PRESENTATION_DE_MES_ACHATS, retraitOffertAuClient, SANS_LA_CASE_ACHATS, type AchatDuClient,
} from '../lib/achatsClientVue'
import { lireMesAchats, type MesAchatsLus } from '../lib/achatsClientLecture'
import type { EtatDeLEcheance } from '../lib/achatsClient'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'
import { appelsDeLaReleveDuClient } from '../lib/receptionPlateforme'
import {
  phrasesDuBilan, releverMaPlateforme, type BilanDeLaReleve,
} from '../lib/receptionParLeClient'

// « MES ACHATS » (espace client, ligne 51.5, étape B5 ; la base : B4, `achats_du_client`). L'écran du client qui porte la case
// « Achats » sur la société AFFICHÉE : les factures d'achat du dossier, leur échéance (au jour de Paris), ce qu'il a déclaré
// payé. Trois gestes, chacun par sa fonction seule : « J'ai payé » (`declarer_paiement_piece` — une PROPOSITION au cabinet,
// rien ne s'écrit en comptabilité), retirer sa propre déclaration (`retirer_paiement_declare`), fixer une échéance que la
// facture ne donne pas (`fixer_echeance_piece`, à la version lue). À l'ouverture, les factures qu'il n'avait pas vues se
// disent « nouvelles » et se marquent vues (`marquer_vues`, par lots de cinq cents au plus).
//
// LA CASE SE LIT DEUX FOIS (lib/achatsClientLecture.ts) : à la connexion pour la route, puis à la BASE avec les achats. RIEN
// N'EST AFFIRMÉ NI OFFERT SUR UNE LECTURE ABSENTE, EN COURS OU PARTIELLE : les pièces et les déclarations lues en entier, sinon
// aucune facture ne s'affiche ; les vues lues en partie, rien ne se dit « nouveau » ni ne se marque. Le refus du module se dit
// avant le clic, sur la saisie telle qu'elle part ; celui de la base, après, réécrit pour le client. Un verrou `useRef` par
// famille de gestes, relâché après la relecture. Jamais la catégorie, le compte ni l'écriture.

const BADGE: Readonly<Record<EtatDeLEcheance, string>> = {
  sans: 'badge-neutral', a_venir: 'badge-ok', aujourd_hui: 'badge-warning', en_retard: 'badge-danger',
}

/** Les lots à marquer vues d'une lecture : nuls si elle n'est pas entière, vues comprises (rien ne se dit alors nouveau). */
function lotsAMarquer(l: MesAchatsLus): string[][] | null {
  if (l.etat !== 'lus' || !l.pieces.complete || !l.paiements.complete || !l.vues.complete) return null
  return lotsDeVues(achatsDits(l.pieces.lignes, l.paiements.lignes, l.vues.lignes, aujourdHuiAParis()))
}

type Formulaire =
  | { pieceId: string; genre: 'paiement'; date: string; moyen: string; montant: string }
  | { pieceId: string; genre: 'echeance'; echeance: string }

export default function ClientAchats() {
  const { dossierActifId, session } = useAuth()
  const dossierId = dossierActifId
  const moi = session?.user.id ?? null
  const [lecture, setLecture] = useState<MesAchatsLus | null>(null)
  const [formulaire, setFormulaire] = useState<Formulaire | null>(null)
  const [message, setMessage] = useState<{ pieceId: string; genre: 'ok' | 'erreur'; texte: string } | null>(null)
  const [nouvelles, setNouvelles] = useState<ReadonlySet<string> | null>(null)
  const [vuesNonMarquees, setVuesNonMarquees] = useState<string | null>(null)
  const ecritureEnCours = useRef(false)
  const marquageEnCours = useRef(false)
  const [occupe, setOccupe] = useState(false)
  const derniereLecture = useRef(0)
  // « Relever ma plateforme » (étape B4r) : le serveur reçoit chaque facture d'achat et écrit sa pièce ; l'écran n'écrit rien.
  const releveEnCours = useRef(false)
  const [releve, setReleve] = useState<{ dossierId: string; faites: number; bilan: BilanDeLaReleve | null } | null>(null)

  useEffect(() => {
    if (!dossierId || !moi) return
    // La coque remonte l'écran à chaque changement de société (`<Outlet key>`) ; une réponse arrivée après coup ne s'écrit pas.
    let annule = false
    const numero = ++derniereLecture.current
    lireMesAchats(dossierId, moi).then(async (l) => {
      if (annule || numero !== derniereLecture.current) return
      setLecture(l)
      // « Nouvelles depuis ta dernière visite » : arrêtées à cette PREMIÈRE lecture (une relecture après un geste ne les fait
      // pas disparaître de la visite), puis marquées vues, lot par lot. Des vues lues en partie ne disent rien de nouveau et ne
      // marquent rien.
      const lots = lotsAMarquer(l)
      if (lots === null || marquageEnCours.current) return
      marquageEnCours.current = true
      setNouvelles(new Set(lots.flat()))
      try {
        for (const lot of lots) {
          const { error } = await supabase.rpc('marquer_vues', { p_dossier_id: l.dossierId, p_pieces: lot })
          if (error) {
            setVuesNonMarquees(pourLEspace('client', `Tes factures n’ont pas pu se marquer vues : ${messageErreur(error, 'refus de la base.')} Elles se diront encore nouvelles à ta prochaine visite.`))
            return
          }
        }
      } finally {
        marquageEnCours.current = false
      }
    })
    return () => { annule = true }
  }, [dossierId, moi])

  async function relire(id: string, compte: string) {
    const numero = ++derniereLecture.current
    const l = await lireMesAchats(id, compte)
    if (numero === derniereLecture.current) setLecture(l)
  }

  const lue = lecture !== null && lecture.dossierId === dossierId ? lecture : null
  const entiere = lue?.etat === 'lus' && lue.pieces.complete && lue.paiements.complete ? lue : null
  const vuesLues = entiere !== null && entiere.vues.complete
  const aujourdhui = aujourdHuiAParis()
  const dits = entiere !== null
    ? achatsDits(entiere.pieces.lignes, entiere.paiements.lignes, vuesLues ? entiere.vues.lignes : [], aujourdhui) : []

  /** Ce que le geste a donné, dit sur sa facture : le refus de la base réécrit pour le client, ou la réussite. */
  function conclure(pieceId: string, error: unknown, reussi: string, rate: string) {
    if (error) {
      setMessage({ pieceId, genre: 'erreur', texte: pourLEspace('client', `${rate} : ${messageErreur(error, 'refus de la base.')}`) })
    } else {
      setMessage({ pieceId, genre: 'ok', texte: reussi })
      setFormulaire(null)
    }
  }

  async function declarer(f: Extract<Formulaire, { genre: 'paiement' }>) {
    if (ecritureEnCours.current || !dossierId || !moi) return
    ecritureEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('declarer_paiement_piece', {
        p_piece_id: f.pieceId, p_date: f.date, p_moyen: f.moyen, p_montant: montantSaisi(f.montant),
      })
      conclure(f.pieceId, error, 'Ton paiement est déclaré à ton cabinet.', 'Ton paiement n’est pas déclaré')
    } finally {
      await relire(dossierId, moi)
      ecritureEnCours.current = false
      setOccupe(false)
    }
  }

  async function retirer(p: PaiementDeclare, nomFichier: string) {
    if (ecritureEnCours.current || !dossierId || !moi) return
    if (!window.confirm(confirmationDuRetraitAuClient(p, nomFichier))) return
    ecritureEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('retirer_paiement_declare', { p_paiement_id: p.id })
      conclure(p.piece_id, error, 'Ta déclaration est retirée.', 'Ta déclaration n’est pas retirée')
    } finally {
      await relire(dossierId, moi)
      ecritureEnCours.current = false
      setOccupe(false)
    }
  }

  async function fixer(piece: AchatDuClient, echeance: string) {
    if (ecritureEnCours.current || !dossierId || !moi) return
    ecritureEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('fixer_echeance_piece', {
        p_piece_id: piece.id, p_echeance: echeance === '' ? null : echeance, p_echeance_lue: piece.date_echeance,
      })
      conclure(piece.id, error, 'L’échéance est enregistrée.', 'L’échéance n’est pas enregistrée')
    } finally {
      await relire(dossierId, moi)
      ecritureEnCours.current = false
      setOccupe(false)
    }
  }

  async function relever() {
    if (releveEnCours.current || !dossierId || !moi) return
    releveEnCours.current = true
    const id = dossierId
    setReleve({ dossierId: id, faites: 0, bilan: null })
    try {
      const bilan = await releverMaPlateforme(appelsDeLaReleveDuClient(id), (faites) => setReleve({ dossierId: id, faites, bilan: null }))
      setReleve({ dossierId: id, faites: 0, bilan })
    } catch (e) {
      setReleve({ dossierId: id, faites: 0, bilan: {
        recues: 0, sansLisible: 0, dejaLa: 0, doublons: 0, auCabinet: 0, autreEntreprise: 0, enAttente: 0, rejetees: 0, ecartees: 0,
        echecs: [], complete: false, motif: null,
        interruption: `Ta plateforme n’a pas pu être relevée : ${messageErreur(e, 'la relève s’est interrompue.')}`,
      } })
    } finally {
      await relire(id, moi)
      releveEnCours.current = false
    }
  }

  const releveDuDossier = releve !== null && releve.dossierId === dossierId ? releve : null

  return (
    <>
      <div className="topbar"><h1>Mes achats</h1></div>
      <p className="muted" style={{ marginTop: 0 }}>{PRESENTATION_DE_MES_ACHATS}</p>
      {entiere !== null && (
        <section className="card" aria-label="Ma plateforme" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn btn-outline" disabled={releveDuDossier !== null && releveDuDossier.bilan === null}
              onClick={() => { void relever() }}>Relever ma plateforme</button>
            <span className="muted">Tes factures d’achat reçues sur ta plateforme arrivent chez ton cabinet, à valider ; rien n’est payé ni rangé pour toi.</span>
          </div>
          {releveDuDossier !== null && releveDuDossier.bilan === null && (
            <p className="muted" role="status">Relève en cours{releveDuDossier.faites > 0 ? ` : ${releveDuDossier.faites} facture${releveDuDossier.faites === 1 ? '' : 's'} traitée${releveDuDossier.faites === 1 ? '' : 's'}` : ''}…</p>
          )}
          {releveDuDossier?.bilan != null && (
            <div role="status">
              {releveDuDossier.bilan.interruption !== null && <p className="error-text">{releveDuDossier.bilan.interruption}</p>}
              {phrasesDuBilan(releveDuDossier.bilan).map((phrase) => <p key={phrase} style={{ margin: '4px 0' }}>{phrase}</p>)}
            </div>
          )}
        </section>
      )}
      {lue === null ? (
        <p className="muted">Chargement…</p>
      ) : lue.etat === 'echec' ? (
        <p className="error-text">Tes achats ne s’affichent pas : {lue.motif}. Recharge la page.</p>
      ) : lue.etat === 'sans_achats' ? (
        <p className="muted">{SANS_LA_CASE_ACHATS}</p>
      ) : entiere === null ? (
        <BandeauLecturePartielle quoi="Tes factures d’achat" accord="lues" technique={false}
          motif={lue.pieces.motif ?? lue.paiements.motif}
          consequence="Aucune ne s’affiche : l’une d’elles, ou un paiement déclaré, pourrait manquer. Recharge la page." />
      ) : dits.length === 0 ? (
        <p className="muted">Ton cabinet n’a reçu aucune facture d’achat de ta société pour l’instant.</p>
      ) : (
        <>
          <BandeauLecturePartielle quoi="Tes visites" accord="lues" technique={false} motif={entiere.vues.motif}
            consequence="Rien ne se dit « nouveau » aujourd’hui. Recharge la page." />
          {vuesNonMarquees !== null && <p className="muted" role="status">{vuesNonMarquees}</p>}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            {dits.map(({ piece, etat, declarees, retirees }) => {
              const origine = moi !== null ? origineDeLEcheanceAuClient(piece, moi) : null
              const ouvert = formulaire !== null && formulaire.pieceId === piece.id ? formulaire : null
              const lueSurLaFacture = echeanceLueSurLaFacture(piece)
              return (
                <li key={piece.id} className="card" aria-label={`Facture « ${piece.nom_fichier} »`}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <strong>{piece.tiers ?? piece.nom_fichier}</strong>
                    {nouvelles?.has(piece.id) && <span className="badge badge-ok">Nouvelle</span>}
                    <span className={`badge ${BADGE[etat]}`}>{MOTS_DE_L_ECHEANCE[etat]}</span>
                  </div>
                  <p className="muted" style={{ margin: '4px 0' }}>
                    {piece.identite_numero !== null && `N° ${piece.identite_numero} · `}
                    {piece.date_piece !== null ? `du ${formatDate(piece.date_piece)}` : 'sans date lue'}
                    {piece.montant_ttc !== null && <> · <span>{formatMoney(piece.montant_ttc)}</span> TTC</>}
                    {' · '}{piece.statut === 'validee' ? 'validée par ton cabinet' : 'à valider chez ton cabinet'}
                    {piece.tiers !== null && <> · <span className="nom-fichier">{piece.nom_fichier}</span></>}
                  </p>
                  <p style={{ margin: '4px 0' }}>
                    {piece.date_echeance !== null ? `Échéance le ${formatDate(piece.date_echeance)}` : 'Aucune échéance'}
                    {origine !== null && <span className="muted"> ({origine})</span>}
                  </p>
                  {[...declarees, ...retirees].length > 0 && (
                    <ul style={{ margin: '6px 0', paddingLeft: 16 }}>
                      {[...declarees, ...retirees].map((p) => (
                        <li key={p.id} className={p.retire_le === null ? undefined : 'muted'}>
                          {moi !== null ? declarationDiteAuClient(p, moi) : null}
                          {moi !== null && retraitOffertAuClient(p, moi) && (
                            <> <button type="button" className="btn btn-outline btn-sm" disabled={occupe}
                              onClick={() => { void retirer(p, piece.nom_fichier) }}>Retirer</button></>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {ouvert === null ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                      <button type="button" className="btn btn-primary btn-sm" disabled={occupe}
                        onClick={() => setFormulaire({
                          pieceId: piece.id, genre: 'paiement', date: aujourdhui, moyen: '',
                          montant: piece.montant_ttc === null ? '' : String(piece.montant_ttc).replace('.', ','),
                        })}>
                        J’ai payé
                      </button>
                      {!lueSurLaFacture && (
                        <button type="button" className="btn btn-outline btn-sm" disabled={occupe}
                          onClick={() => setFormulaire({ pieceId: piece.id, genre: 'echeance', echeance: piece.date_echeance ?? '' })}>
                          {piece.date_echeance === null ? 'Fixer l’échéance' : 'Changer l’échéance'}
                        </button>
                      )}
                    </div>
                  ) : ouvert.genre === 'paiement' ? (
                    <FormulaireDuPaiement f={ouvert} aujourdhui={aujourdhui} occupe={occupe}
                      changer={(f) => setFormulaire(f)} annuler={() => setFormulaire(null)} envoyer={(f) => { void declarer(f) }} />
                  ) : (
                    <FormulaireDeLEcheance f={ouvert} piece={piece} occupe={occupe}
                      changer={(f) => setFormulaire(f)} annuler={() => setFormulaire(null)} envoyer={(e) => { void fixer(piece, e) }} />
                  )}
                  {message !== null && message.pieceId === piece.id && (message.genre === 'ok'
                    ? <p role="status">{message.texte}</p>
                    : <p className="error-text" role="alert">{message.texte}</p>)}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}

function FormulaireDuPaiement({ f, aujourdhui, occupe, changer, annuler, envoyer }: {
  f: Extract<Formulaire, { genre: 'paiement' }>
  aujourdhui: string
  occupe: boolean
  changer: (f: Formulaire) => void
  annuler: () => void
  envoyer: (f: Extract<Formulaire, { genre: 'paiement' }>) => void
}) {
  const refus = refusDeLaDeclaration({ date: f.date === '' ? null : f.date, moyen: moyenSaisi(f.moyen), montant: montantSaisi(f.montant) }, aujourdhui)
  return (
    <div style={{ marginTop: 6 }}>
      <div className="field-row aligne-bas" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label>
          Payée le
          <input type="date" value={f.date} max={aujourdhui} disabled={occupe} onChange={(e) => changer({ ...f, date: e.target.value })} />
        </label>
        <label>
          Moyen
          <select value={f.moyen} disabled={occupe} onChange={(e) => changer({ ...f, moyen: e.target.value })}>
            <option value="">Choisis…</option>
            {MOYENS_DECLARES.map((m) => <option key={m} value={m}>{LIBELLES_DES_MOYENS[m]}</option>)}
          </select>
        </label>
        <label>
          Montant payé (€)
          <input type="text" inputMode="decimal" value={f.montant} disabled={occupe} onChange={(e) => changer({ ...f, montant: e.target.value })} />
        </label>
        <button type="button" className="btn btn-primary btn-sm" disabled={occupe || refus !== null}
          title={refus === null ? undefined : pourLEspace('client', refus)} onClick={() => envoyer(f)}>
          Déclarer ce paiement
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={annuler}>Annuler</button>
      </div>
      {refus !== null && <p className="error-text">{pourLEspace('client', refus)}</p>}
    </div>
  )
}

function FormulaireDeLEcheance({ f, piece, occupe, changer, annuler, envoyer }: {
  f: Extract<Formulaire, { genre: 'echeance' }>
  piece: AchatDuClient
  occupe: boolean
  changer: (f: Formulaire) => void
  annuler: () => void
  envoyer: (echeance: string) => void
}) {
  const echeance = f.echeance === '' ? null : f.echeance
  const refus = refusDeLEcheance(piece, echeance, piece.date_echeance, false)
  const inchangee = echeance === piece.date_echeance
  return (
    <div style={{ marginTop: 6 }}>
      <div className="field-row aligne-bas" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label>
          Échéance
          <input type="date" value={f.echeance} disabled={occupe} onChange={(e) => changer({ ...f, echeance: e.target.value })} />
        </label>
        <button type="button" className="btn btn-primary btn-sm" disabled={occupe || refus !== null || inchangee}
          title={refus === null ? undefined : pourLEspace('client', refus)} onClick={() => envoyer(f.echeance)}>
          {echeance === null ? 'Effacer l’échéance' : 'Enregistrer l’échéance'}
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={annuler}>Annuler</button>
      </div>
      {refus !== null && <p className="error-text">{pourLEspace('client', refus)}</p>}
    </div>
  )
}
