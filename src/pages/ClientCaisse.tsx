import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { messageErreur } from '../lib/messageErreur'
import { aujourdHuiAParis } from '../lib/format'
import { jourDit, type SaisieDeCaisse } from '../lib/caisse'
import { euros } from '../lib/caisseEcran'
import {
  anneeFigee, auteurPourLeClient, caisseRejouee, confirmationDeLaCorrection, confirmationDeLaSaisie, confirmationDuRetrait,
  corrigeableParLeClient, devenirDeLaRetiree, dossierDuClient, GENRES_DU_CLIENT, joursDuMois, libelleDeLaLigne, MOIS_DE_L_ANNEE,
  nomPourLeClient, RAPPEL_DU_BROUILLARD, refusDuRetraitDuClient, retireesDuMois, saisieDuClient, soldeLuAu, verdictDuFormulaire,
  type FormulaireDuClient, type GenreDuClient, type OperationDuClient,
} from '../lib/caisseClient'
import { lireLaCaisseDuClient, type LectureDeLaCaisseDuClient } from '../lib/caisseClientLecture'
import { pourLEspace } from '../lib/espaceVentes'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'

// « MA CAISSE » (espace client, ligne 26.6, étape C12a ; conception : HISTORIQUE.md, « LA CAISSE : LA SAISIE DU PRATICIEN ET LA
// PIÈCE RÉGLÉE PAR LA CAISSE — LA CONCEPTION REPRISE (CAISSE-Q1 ET Q4) », § 5 et 7). L'écran du praticien qui porte la case
// « Caisse » sur la société AFFICHÉE : sa caisse, mois par mois, jour par jour, le solde LU à la fin de chaque jour ; et ses
// gestes, par les fonctions de la base et elles seules — saisir les recettes en espèces d'un jour (la nature est celle que son
// cabinet a fixée), un apport ou un prélèvement ; corriger ou retirer ce qu'IL a saisi. Ce que son cabinet a saisi se lit, sans
// geste. Jamais une catégorie, un compte, une écriture, ni un nom.
//
// LA CASE SE LIT DEUX FOIS (lib/caisseClientLecture.ts) : à la connexion pour la route, puis à la BASE avec les lectures.
//
// RIEN N'EST AFFIRMÉ NI OFFERT SUR UNE LECTURE ABSENTE, EN COURS OU PARTIELLE : « Chargement… » avant le retour, et à chaque
// changement d'année ; les opérations ou les jours lus en partie ne montrent rien de la caisse et n'offrent rien ; une caisse
// que le module ne recompose pas sur ce qui a été lu (lib/caisseClient.ts, `caisseRejouee`) non plus. Les refus de la base se
// disent AVANT le clic, aux mots du module, sur la saisie TELLE QU'ELLE PART ; chaque geste se confirme, la confirmation nommant
// ce qui part ; un seul verrou `useRef` pour tous, relâché après la relecture.

type Message = { genre: 'ok' | 'erreur'; texte: string }

const FORMULAIRE_VIDE: FormulaireDuClient = { genre: 'recette', date: '', montant: '' }

// Le nom d'une ligne d'opération dans le jour : son genre seulement (le jour et le montant sont dans leurs colonnes).
function genreDit(o: Pick<OperationDuClient, 'genre' | 'montant'>): string {
  if (o.genre === 'recette') return o.montant < 0 ? 'Espèces rendues' : 'Recettes en espèces'
  if (o.genre === 'apport') return 'Apport de ta poche'
  if (o.genre === 'prelevement') return 'Prélèvement pour toi'
  return o.montant < 0 ? 'Pièce payée en espèces' : 'Espèces reçues pour une pièce'
}

export default function ClientCaisse() {
  const { dossierActifId, session } = useAuth()
  const dossierId = dossierActifId
  const moi = session?.user.id ?? null
  // « Maintenant » se lit au rendu, jamais au chargement du module.
  const aujourdhui = aujourdHuiAParis()
  const anneeEnCours = Number(aujourdhui.slice(0, 4))
  const [annee, setAnnee] = useState(anneeEnCours)
  const [mois, setMois] = useState<number | null>(null)
  const [lecture, setLecture] = useState<LectureDeLaCaisseDuClient | null>(null)
  const [formulaire, setFormulaire] = useState<FormulaireDuClient>(FORMULAIRE_VIDE)
  // L'opération que la saisie corrige : la version qu'elle remplace, retenue avec elle.
  const [remplace, setRemplace] = useState<string | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  // UN verrou pour tous les gestes : ils relisent tous la même caisse, et un geste parti pendant la relecture d'un autre
  // s'appuierait sur une caisse pas encore revenue. Relâché après la relecture.
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    if (!dossierId) return
    // La coque remonte l'écran à chaque changement de société (`<Outlet key>`) ; une année changée relit : une réponse arrivée
    // après coup ne s'écrit pas.
    let annule = false
    lireLaCaisseDuClient(dossierId, annee, anneeEnCours).then((l) => { if (!annule) setLecture(l) })
    return () => { annule = true }
  }, [dossierId, annee, anneeEnCours])

  async function relire() {
    if (!dossierId) return
    const l = await lireLaCaisseDuClient(dossierId, annee, anneeEnCours)
    setLecture(l)
  }

  if (!dossierId || !moi) {
    return <p className="muted">Aucune société ne t’est encore rattachée — contacte ton cabinet comptable.</p>
  }

  // La lecture n'est montrée que pour la société et l'année qu'elle a lues : une autre clé repart en « Chargement… ».
  const lue = lecture && lecture.dossierId === dossierId && lecture.annee === annee ? lecture : null

  // ── Ce qui se rejoue, et ce qui s'offre ─────────────────────────────────────────────────────────────────────────────
  const entiere = lue?.etat === 'lue' && lue.operations.complete && lue.jours.complete ? lue : null
  const rejouee = entiere ? caisseRejouee(entiere.jours.lignes, entiere.operations.lignes, annee) : null
  const ouverture = entiere ? saisieDuClient(entiere.dossier, entiere.nature) : null
  const figee = entiere ? anneeFigee(entiere.jours.lignes, annee) : null
  const dossier = entiere && rejouee?.etat
    ? dossierDuClient({ dossier: entiere.dossier, moi, aujourdhui }, entiere.nature, rejouee.etat) : null
  // Les gestes : sur une caisse lue en entier et recomposée, une saisie ouverte, une année que la lecture ne dit pas figée.
  const gestes = dossier !== null && ouverture?.ouverte === true && figee !== true
  const verdict = gestes && entiere ? verdictDuFormulaire(formulaire, annee, entiere.jours.lignes, dossier, remplace) : null

  // ── Les gestes ──────────────────────────────────────────────────────────────────────────────────────────────────────

  // Un geste : le verrou, l'appel, la relecture (même sur un refus : la base répond souvent « relis ta caisse »), le message.
  // `appel` rend le refus de la base aux mots du client, ou rien quand elle a écrit.
  async function agir(appel: () => Promise<string | null>, reussite: string, echec: string, apres?: () => void) {
    // Le verrou est lu ET posé ici, avant le premier `await`.
    if (ecritureEnCours.current) return
    ecritureEnCours.current = true
    setEnCours(true)
    setMessage(null)
    try {
      const refus = await appel()
      if (refus !== null) {
        setMessage({ genre: 'erreur', texte: `${echec} : ${refus}` })
      } else {
        apres?.()
        setMessage({ genre: 'ok', texte: reussite })
      }
      await relire()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  // Chaque fonction par son propre appel, son `{ error }` lu et rendu aux mots du client : jamais une écriture supposée
  // réussie. Le client n'envoie ni catégorie, ni taux, ni écriture : la base les pose.
  async function appelerEnregistrer(s: SaisieDeCaisse): Promise<string | null> {
    const { error } = await supabase.rpc('enregistrer_operation_caisse', {
      p_dossier_id: dossierId, p_genre: s.genre, p_date: s.date, p_montant: s.montant, p_categorie_id: null,
      p_taux_tva: null, p_encaissements_du_jour: s.encaissements_du_jour, p_ecritures: null,
    })
    return error ? pourLEspace('client', messageErreur(error, 'raison inconnue')) : null
  }

  async function appelerRemplacer(operationId: string, s: SaisieDeCaisse): Promise<string | null> {
    const { error } = await supabase.rpc('remplacer_operation_caisse', {
      p_dossier_id: dossierId, p_operation_id: operationId, p_genre: s.genre, p_date: s.date, p_montant: s.montant,
      p_categorie_id: null, p_taux_tva: null, p_encaissements_du_jour: s.encaissements_du_jour, p_ecritures: null,
    })
    return error ? pourLEspace('client', messageErreur(error, 'raison inconnue')) : null
  }

  async function appelerRetirer(operationId: string): Promise<string | null> {
    const { error } = await supabase.rpc('retirer_operation_caisse', { p_dossier_id: dossierId, p_operation_id: operationId })
    return error ? pourLEspace('client', messageErreur(error, 'raison inconnue')) : null
  }

  function remettreLeFormulaire() {
    setFormulaire((f) => ({ ...FORMULAIRE_VIDE, genre: f.genre, date: f.date }))
    setRemplace(null)
  }

  async function enregistrer() {
    if (ecritureEnCours.current || !entiere || verdict === null || verdict.etat !== 'permis') return
    const s = verdict.saisie
    const ancienne = remplace == null ? null : entiere.operations.lignes.find((o) => o.id === remplace) ?? null
    if (remplace != null && ancienne == null) return
    const question = ancienne == null ? confirmationDeLaSaisie(s, verdict.soldeApres) : confirmationDeLaCorrection(ancienne, s, verdict.soldeApres)
    if (!window.confirm(question)) return
    const cible = remplace
    await agir(
      () => (cible == null ? appelerEnregistrer(s) : appelerRemplacer(cible, s)),
      `${cible == null ? 'Enregistré' : 'Corrigé'} : ${nomPourLeClient({ genre: s.genre as OperationDuClient['genre'], date: s.date ?? '', montant: s.montant ?? 0 }, 'un')}.`,
      cible == null ? 'Ta saisie n’a pas été enregistrée' : 'Ta correction n’a pas été enregistrée',
      remettreLeFormulaire,
    )
  }

  async function retirer(o: OperationDuClient) {
    if (ecritureEnCours.current || !rejouee?.etat) return
    if (!window.confirm(confirmationDuRetrait(o, rejouee.etat))) return
    await agir(
      () => appelerRetirer(o.id),
      `Retiré : ${nomPourLeClient(o)}.`,
      'Ta saisie n’a pas été retirée',
      () => { if (remplace === o.id) remettreLeFormulaire() },
    )
  }

  function preparerLaCorrection(o: OperationDuClient) {
    if (ecritureEnCours.current) return
    setRemplace(o.id)
    setMessage(null)
    setFormulaire({
      genre: o.genre === 'apport' || o.genre === 'prelevement' ? o.genre : 'recette',
      date: o.date,
      montant: String(o.montant).replace('.', ','),
    })
  }

  // ── L'écran ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const anneesOffertes = (() => {
    const lues = lue?.etat === 'lue' ? lue.operations.lignes.map((o) => Number(o.date.slice(0, 4))) : []
    const premiere = Math.min(anneeEnCours - 1, annee, ...lues)
    return Array.from({ length: anneeEnCours - premiere + 1 }, (_, i) => anneeEnCours - i)
  })()
  const moisAffiche = mois ?? (annee === anneeEnCours ? Number(aujourdhui.slice(5, 7)) : 12)
  const prefixeDuMois = `${annee}-${String(moisAffiche).padStart(2, '0')}`
  const finDuMois = `${prefixeDuMois}-31`

  return (
    <>
      <div className="topbar"><h1>Ma caisse</h1></div>
      <p className="muted" style={{ marginTop: 0 }}>
        Tes espèces, jour par jour : ce que tu saisis ici, ton cabinet le voit aussitôt et le passe dans tes comptes.
        {' '}{RAPPEL_DU_BROUILLARD}
      </p>

      <div className="field-row" style={{ marginBottom: 12 }}>
        <div className="field">
          <label htmlFor="caisse-annee">Année</label>
          <select
            id="caisse-annee"
            value={String(annee)}
            disabled={enCours}
            onChange={(e) => { setAnnee(Number(e.target.value)); setMois(null); setRemplace(null); setFormulaire(FORMULAIRE_VIDE); setMessage(null) }}
          >
            {anneesOffertes.map((a) => <option key={a} value={String(a)}>{a}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="caisse-mois">Mois</label>
          <select id="caisse-mois" value={String(moisAffiche)} onChange={(e) => setMois(Number(e.target.value))}>
            {MOIS_DE_L_ANNEE.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
        </div>
      </div>

      {lue === null ? (
        <p className="muted">Chargement…</p>
      ) : lue.etat === 'echec' ? (
        <p className="error-text">Ta caisse ne s’affiche pas : {lue.motif}. Sans elle, rien ne t’est montré ni proposé. Recharge la page.</p>
      ) : lue.etat === 'sans_caisse' ? (
        <p className="muted">
          Ton accès ne porte plus « Caisse » sur cette société : ta caisse ne s’affiche pas ici. Pour la retrouver, demande à ton
          cabinet d’ajouter « Caisse » à ton accès.
        </p>
      ) : (
        <>
          <BandeauLecturePartielle
            quoi="Tes opérations de caisse" accord="lues" motif={lue.operations.motif} technique={false}
            consequence="Ta caisse ne s’affiche pas, et rien ne t’est proposé : une opération manquante fausserait ton solde. Recharge la page."
          />
          <BandeauLecturePartielle
            quoi="Les jours de ta caisse" accord="lus" motif={lue.jours.motif} technique={false}
            consequence="Ta caisse ne s’affiche pas, et rien ne t’est proposé : un jour manquant fausserait ton solde. Recharge la page."
          />
          {entiere && rejouee && rejouee.etat === null && (
            <p className="error-text">
              Ta caisse ne se recompose pas sur ce qui a été lu ({rejouee.motif}) : rien ne t’est proposé. Recharge la page ; si
              cela dure, dis-le à ton cabinet.
            </p>
          )}
          {entiere && (
            <Caisse
              lecture={entiere}
              annee={annee}
              anneeEnCours={anneeEnCours}
              aujourdhui={aujourdhui}
              prefixeDuMois={prefixeDuMois}
              finDuMois={finDuMois}
              moisAffiche={moisAffiche}
              moi={moi}
              gestes={gestes}
              enCours={enCours}
              raisonFermee={ouverture && !ouverture.ouverte ? ouverture.raison : null}
              figee={figee === true}
              dossierRejoue={dossier}
              onCorriger={preparerLaCorrection}
              onRetirer={retirer}
            />
          )}
          {message && (
            <p className={message.genre === 'erreur' ? 'error-text' : 'muted'} role={message.genre === 'erreur' ? 'alert' : 'status'}>
              {message.texte}
            </p>
          )}
          {gestes && entiere && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>{remplace == null ? 'Saisir dans ta caisse' : 'Corriger ta saisie'}</h3>
              {remplace != null && (
                <p className="muted" style={{ marginTop: 0 }}>
                  Tu corriges {nomPourLeClient(entiere.operations.lignes.find((o) => o.id === remplace) ?? { genre: formulaire.genre, date: formulaire.date, montant: 0 })} :
                  l’ancienne restera dans l’historique de ta caisse, retirée.
                </p>
              )}
              <div className="field-row aligne-bas">
                <div className="field">
                  <label htmlFor="caisse-genre">Quoi</label>
                  <select
                    id="caisse-genre"
                    value={formulaire.genre}
                    disabled={enCours}
                    onChange={(e) => setFormulaire((f) => ({ ...f, genre: e.target.value as GenreDuClient }))}
                  >
                    {GENRES_DU_CLIENT.map((g) => <option key={g.genre} value={g.genre}>{g.libelle}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="caisse-date">Jour</label>
                  <input
                    id="caisse-date"
                    type="date"
                    value={formulaire.date}
                    min={`${annee}-01-01`}
                    max={annee === anneeEnCours ? aujourdhui : `${annee}-12-31`}
                    disabled={enCours}
                    onChange={(e) => setFormulaire((f) => ({ ...f, date: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="caisse-montant">Montant (€)</label>
                  <input
                    id="caisse-montant"
                    inputMode="decimal"
                    value={formulaire.montant}
                    placeholder="125,50"
                    disabled={enCours}
                    onChange={(e) => setFormulaire((f) => ({ ...f, montant: e.target.value }))}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={enCours || verdict?.etat !== 'permis'}
                  onClick={() => { void enregistrer() }}
                >
                  {remplace == null ? 'Enregistrer' : 'Remplacer'}
                </button>
                {remplace != null && (
                  <button type="button" className="btn btn-outline" disabled={enCours} onClick={remettreLeFormulaire}>
                    Annuler la correction
                  </button>
                )}
              </div>
              {formulaire.genre === 'recette' && (
                <p className="muted" style={{ marginBottom: 0 }}>
                  Le total des espèces reçues ce jour-là, sans les espèces de tes factures que ta caisse compte déjà.
                </p>
              )}
              {(verdict?.etat === 'refuse' || verdict?.etat === 'illisible') && (
                <p className="error-text" role="alert">{verdict.message}</p>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}

interface ProprietesCaisse {
  lecture: Extract<LectureDeLaCaisseDuClient, { etat: 'lue' }>
  annee: number
  anneeEnCours: number
  aujourdhui: string
  prefixeDuMois: string
  finDuMois: string
  moisAffiche: number
  moi: string
  gestes: boolean
  enCours: boolean
  raisonFermee: string | null
  figee: boolean
  dossierRejoue: ReturnType<typeof dossierDuClient> | null
  onCorriger: (o: OperationDuClient) => void
  onRetirer: (o: OperationDuClient) => void
}

// La caisse lue en entier : le solde, le mois jour par jour, ce qui a été retiré ; et les gestes sur ce que le praticien a saisi.
function Caisse(p: ProprietesCaisse) {
  const jours = p.lecture.jours.lignes
  const operations = p.lecture.operations.lignes
  const duMois = joursDuMois(jours, operations, p.prefixeDuMois)
  const retirees = retireesDuMois(operations, p.prefixeDuMois)
  const jourDuSolde = p.annee === p.anneeEnCours ? p.aujourdhui : `${p.annee}-12-31`
  const nomDuMois = `${MOIS_DE_L_ANNEE[p.moisAffiche - 1]} ${p.annee}`

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Ta caisse</h3>
        <p style={{ margin: 0 }}>
          Au {jourDit(jourDuSolde)} : <strong>{euros(soldeLuAu(jours, jourDuSolde))}</strong>
          {' '}· à la fin de {nomDuMois} : {euros(soldeLuAu(jours, p.finDuMois))}
        </p>
        {p.raisonFermee && <p className="muted" style={{ marginBottom: 0 }}>{p.raisonFermee}</p>}
        {p.figee && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Ton cabinet a validé tes comptes de {p.annee} : ta caisse de cette année ne change plus.
          </p>
        )}
      </div>

      <h3>{nomDuMois.charAt(0).toUpperCase() + nomDuMois.slice(1)}</h3>
      <div className="card table-scroll" style={{ padding: 0 }}>
        {duMois.length === 0 ? (
          <div className="empty-state">Ta caisse n’a bougé aucun jour de {nomDuMois}.</div>
        ) : (
          <div className="tableau-adaptable">
            <table className="table-empilable table-empilable-en-carte">
              <thead><tr><th>Jour</th><th>Quoi</th><th>Montant</th><th>Caisse le soir</th><th>Gestes</th></tr></thead>
              <tbody>
                {duMois.flatMap((j) => j.lignes.map((l, i) => {
                  const derniere = i === j.lignes.length - 1
                  const o = l.nature === 'operation' ? l.operation : null
                  const refusDuRetrait = o && p.gestes && p.dossierRejoue && corrigeableParLeClient(o, p.moi) && !j.fige
                    ? refusDuRetraitDuClient(o.id, p.dossierRejoue) : null
                  return (
                    <tr key={`${j.jour}-${o?.id ?? `${l.nature}-${i}`}`}>
                      <td data-libelle="Jour">{jourDit(j.jour)}</td>
                      <td data-libelle="Quoi">
                        {o ? genreDit(o) : libelleDeLaLigne(l as Exclude<typeof l, { nature: 'operation' }>, j.jour)}
                        {o && <span className="muted"> · {auteurPourLeClient(o, p.moi)}</span>}
                      </td>
                      <td data-libelle="Montant" style={{ whiteSpace: 'nowrap' }}>{euros(l.centimes)}</td>
                      <td data-libelle="Caisse le soir" style={{ whiteSpace: 'nowrap' }}>{derniere ? euros(j.solde) : ''}</td>
                      <td className="td-boutons">
                        {o && p.gestes && corrigeableParLeClient(o, p.moi) && !j.fige && (
                          <>
                            <button type="button" className="btn btn-outline btn-sm" disabled={p.enCours} onClick={() => p.onCorriger(o)}>
                              Corriger
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              disabled={p.enCours || refusDuRetrait !== null}
                              title={refusDuRetrait ?? undefined}
                              onClick={() => { void p.onRetirer(o) }}
                            >
                              Retirer
                            </button>
                          </>
                        )}
                        {refusDuRetrait && <span className="error-text" style={{ display: 'block' }}>{refusDuRetrait}</span>}
                      </td>
                    </tr>
                  )
                }))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {retirees.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Retirées ou remplacées en {nomDuMois} ({retirees.length})</summary>
          <ul>
            {retirees.map((o) => (
              <li key={o.id}>
                {nomPourLeClient(o).replace(/^./, (c) => c.toUpperCase())}, {auteurPourLeClient(o, p.moi)} : {devenirDeLaRetiree(o, operations)}.
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}
