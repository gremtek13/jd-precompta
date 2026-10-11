import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { extraireErreurFonction } from '../../lib/invokeErreur'
import { lireConnexionPlateforme } from '../../lib/receptionPlateforme'
import { pourLEspace } from '../../lib/espaceVentes'

interface Statut {
  configured: boolean
  client_id: string | null
}

interface ResultatSync {
  importees: number
  deja_connues: number
  en_attente_traitement: number
  erreurs: string[]
}

// QUI REGARDE (espace client, étape P4b, sous l'hypothèse EC-Q4) : le cabinet, depuis l'onglet Justificatifs, qui configure
// les identifiants ET synchronise les factures du dossier ; ou le client qui porte la case « Ventes », depuis « Mes ventes »,
// qui voit l'état, enregistre et retire les identifiants — les actions que `superpdp-credentials` ouvre à « Ventes »
// (`src/test/quiPeutQuoi.ts`). La synchronisation (`superpdp-sync`) refuse le client : en mode client elle n'existe pas, ni
// bouton ni texte, et le type le garantit — le rappel d'un import n'existe qu'au cabinet. Une propriété OBLIGATOIRE : un
// écran qui oublierait de dire qui regarde ne compile pas.
type QuiRegarde =
  | { espace: 'cabinet'; onImported: () => void }
  | { espace: 'client' }

type Props = QuiRegarde & {
  dossierId: string
  onClose: () => void
}

// Facturation électronique — réception des factures fournisseurs via Super PDP (plateforme de
// dématérialisation partenaire agréée DGFiP, voir supabase/functions/superpdp-sync). Une application
// Super PDP est rattachée à une seule entreprise/SIRET : chaque dossier a ses propres identifiants,
// jamais partagés — à créer sur https://www.superpdp.tech pour l'entreprise de ce dossier.
export default function SuperPdpModal(props: Props) {
  const { dossierId, onClose, espace } = props
  const auCabinet = props.espace === 'cabinet'
  // Une erreur rendue par la fonction peut porter une phrase du cabinet : le client la lit réécrite.
  const motsDe = (texte: string) => pourLEspace(espace, texte)
  const [statut, setStatut] = useState<Statut | null>(null)
  const [reconfigurer, setReconfigurer] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  // Verrou d'exécution des écritures des identifiants (enregistrer, retirer), en `useRef` : `disabled={saving}` ne prend
  // effet qu'au rendu suivant, et deux clics du même rendu enregistraient deux fois — ou retiraient pendant qu'un
  // enregistrement courait. Posé avant le `try`, relâché après la relecture du statut : la fenêtre montre ce qui est écrit.
  const ecritureEnCours = useRef(false)
  const [syncing, setSyncing] = useState(false)
  // Verrou d'exécution de la synchronisation, en `useRef` : `setSyncing(true)` ne prend effet qu'au rendu suivant, donc
  // `disabled={syncing}` laissait passer deux clics du même rendu — deux synchronisations, deux séries d'appels à Super PDP
  // pour les mêmes factures. Relâché à la réponse : la fenêtre montre ce que la fonction a RENDU, elle ne relit rien.
  const synchronisationEnCours = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [resultat, setResultat] = useState<ResultatSync | null>(null)
  // LA PLATEFORME DU CLIENT (fenêtre « Plateforme du client », ligne 28.5) reçoit elle aussi les factures du dossier,
  // par l'API AFNOR. Une facture reçue par les deux chemins entrerait deux fois, et rien ne les rapprocherait : cette
  // synchronisation enregistre un résumé texte de la facture, la plateforme son original, donc l'empreinte d'un fichier
  // diffère. Lue à l'ouverture comme le statut, et comme lui sans appel extérieur : l'action « statut » de
  // `plateforme-agreee` ne lit que la base. Au cabinet seulement : le client ne reçoit rien d'ici.
  const [plateforme, setPlateforme] = useState<{ nom: string | null; erreur: string | null } | null>(null)

  async function chargerStatut() {
    const { data, error: invokeError } = await supabase.functions.invoke<Statut>('superpdp-credentials', {
      body: { dossierId, action: 'status' },
    })
    if (invokeError || !data) {
      // `extraireErreurFonction` et non un message générique : `invoke()` lève avant d'avoir lu le
      // corps, donc `data` est nul et seul `error.context` porte ce que la fonction a répondu
      // (voir lib/invokeErreur.ts). Un « Impossible de vérifier » écrase un motif précis — or le
      // diagnostic Super PDP passe déjà par les logs de production faute de pouvoir appeler l'API
      // d'ici, et masquer le message côté écran rallonge exactement ce chemin-là.
      setError(motsDe(await extraireErreurFonction(invokeError, "Impossible de vérifier la configuration Super PDP.")))
      return
    }
    setStatut(data)
  }

  useEffect(() => { chargerStatut() }, [dossierId])

  useEffect(() => {
    if (!auCabinet) return
    let annule = false
    void lireConnexionPlateforme(dossierId).then((r) => {
      if (annule) return
      setPlateforme(r.erreur !== null ? { nom: null, erreur: r.erreur } : { nom: r.donnees.connexion?.nom ?? null, erreur: null })
    })
    return () => { annule = true }
  }, [dossierId, auCabinet])

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    if (!clientId.trim() || !clientSecret.trim()) return
    // Posé avant le `try` : dedans, le `return` du deuxième clic sortirait par le `finally` et relâcherait le verrou du
    // premier, encore en cours.
    if (ecritureEnCours.current) return
    ecritureEnCours.current = true
    setSaving(true)
    setError(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('superpdp-credentials', {
        body: { dossierId, action: 'save', client_id: clientId.trim(), client_secret: clientSecret.trim() },
      })
      if (data?.error || invokeError) {
        setError(motsDe(data?.error ?? await extraireErreurFonction(invokeError, "Échec de l'enregistrement.")))
        return
      }
      setClientId('')
      setClientSecret('')
      setReconfigurer(false)
      await chargerStatut()
    } finally {
      ecritureEnCours.current = false
      setSaving(false)
    }
  }

  async function retirer() {
    if (ecritureEnCours.current) return
    // La confirmation nomme ce qu'on perd, du point de vue de qui retire.
    if (!window.confirm(auCabinet
      ? "Retirer les identifiants Super PDP de ce dossier ? La synchronisation ne sera plus possible tant qu'ils ne seront pas reconfigurés."
      : 'Retirer les identifiants Super PDP de ta société ? Tes factures ne pourront plus y être transmises d’ici tant '
        + 'qu’ils ne seront pas ressaisis, et ton cabinet ne pourra plus y récupérer tes factures. L’application créée sur '
        + 'Super PDP, elle, reste ouverte : supprime-la sur Super PDP si tu n’en as plus besoin.')) return
    ecritureEnCours.current = true
    setSaving(true)
    try {
      // Le résultat était ignoré : un échec laissait l'écran rafraîchir un statut INCHANGÉ, sans un
      // mot. Le réflexe est alors de recliquer, et d'obtenir le même silence. « Une écriture est
      // vérifiée, jamais supposée réussie » (CLAUDE.md) — et c'est plus vrai encore sur une action
      // destructrice confirmée par l'utilisateur, qui croit l'avoir faite.
      const { error: invokeError } = await supabase.functions.invoke('superpdp-credentials', {
        body: { dossierId, action: 'remove' },
      })
      if (invokeError) {
        setError(motsDe(await extraireErreurFonction(invokeError, "Le retrait des identifiants a échoué.")))
        return
      }
      setError(null)
      setResultat(null)
      await chargerStatut()
    } finally {
      ecritureEnCours.current = false
      setSaving(false)
    }
  }

  async function synchroniser() {
    // Au cabinet seul : `superpdp-sync` refuse le client, et le bouton n'existe pas pour lui.
    if (!auCabinet) return
    // Posé avant le `try` : dedans, le `return` du deuxième clic sortirait par le `finally` et relâcherait le verrou du
    // premier, encore en cours.
    if (synchronisationEnCours.current) return
    synchronisationEnCours.current = true
    setSyncing(true)
    setError(null)
    setResultat(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<ResultatSync & { error?: string }>('superpdp-sync', {
        body: { dossierId },
      })
      if (data?.error || invokeError) {
        setError(data?.error ?? await extraireErreurFonction(invokeError, 'Échec de la synchronisation.'))
        return
      }
      if (data) {
        setResultat(data)
        if (data.importees > 0) props.onImported()
      }
    } finally {
      synchronisationEnCours.current = false
      setSyncing(false)
    }
  }

  const afficherFormulaire = statut !== null && (!statut.configured || reconfigurer)

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(560px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>{auCabinet ? 'Facturation électronique — Super PDP' : 'Super PDP'}</h2>
        {auCabinet ? (
          <p className="muted" style={{ marginTop: -8 }}>
            Récupère automatiquement les factures de ce dossier via Super PDP (plateforme agréée
            DGFiP) : reçues (achats) comme émises (ventes). Chaque facture importée arrive en Pièces
            avec le statut « à valider », comme un import classique — rien n'est jamais validé
            automatiquement.
          </p>
        ) : (
          // Ce que la liaison ouvre, au cabinet aussi : il se sert des mêmes identifiants pour récupérer les factures
          // (`superpdp-sync`, réservée au cabinet). Le client le sait avant de relier.
          <p className="muted" style={{ marginTop: -8 }}>
            Relie ici Super PDP, plateforme agréée, si ta société y émet ses factures : tes factures validées pourront y
            être transmises depuis « Mes ventes ». Ton cabinet se sert des mêmes identifiants pour récupérer tes factures.
          </p>
        )}

        {auCabinet && plateforme?.nom != null && (
          <p className="alerte-tva" style={{ margin: '0 0 12px' }}>
            La plateforme du client ({plateforme.nom}) est aussi reliée à ce dossier (« Plateforme du client ») : une facture
            reçue par les deux chemins entrerait deux fois. N’en gardez qu’un.
          </p>
        )}
        {auCabinet && plateforme?.erreur && (
          <p className="muted">
            La connexion à la plateforme du client n’a pas pu être lue ({plateforme.erreur}) : si elle est reliée à ce
            dossier, une facture reçue par les deux chemins entrerait deux fois.
          </p>
        )}

        {statut === null && !error && <p className="muted">Vérification…</p>}

        {afficherFormulaire && (
          <form onSubmit={enregistrer}>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: -4 }}>
              {auCabinet
                ? 'Identifiants de l\'application OAuth Super PDP créée pour l\'entreprise de ce dossier'
                : 'Identifiants de l’application OAuth Super PDP créée pour ta société'}
              {' '}(Tableau de bord Super PDP → Applications → Confidentielle). Copie-les directement
              depuis le site plutôt que de les retaper à la main.
            </p>
            <div className="field">
              <label htmlFor="spdp-client-id">Identifiant (client_id)</label>
              <input id="spdp-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="spdp-client-secret">Secret (client_secret)</label>
              <input id="spdp-client-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} required />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              {reconfigurer && (
                <button type="button" className="btn btn-outline" onClick={() => setReconfigurer(false)}>Annuler</button>
              )}
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        )}

        {statut?.configured && !reconfigurer && (
          <>
            <p>
              <span className="badge badge-ok">Configuré</span>{' '}
              <span className="muted" style={{ fontSize: '0.85rem' }}>identifiant : {statut.client_id}</span>
            </p>

            {auCabinet && resultat && (
              <div className="card" style={{ background: 'var(--surface-2, #f4f4f4)', marginBottom: 12 }}>
                <p style={{ margin: 0 }}>
                  {resultat.importees} nouvelle(s) facture(s) importée(s)
                  {resultat.deja_connues > 0 && ` — ${resultat.deja_connues} déjà connue(s)`}
                  {resultat.en_attente_traitement > 0 && ` — ${resultat.en_attente_traitement} encore en cours de traitement chez Super PDP (réessaie dans un instant)`}
                </p>
                {resultat.erreurs.length > 0 && (
                  <ul style={{ marginBottom: 0 }}>
                    {resultat.erreurs.map((e, i) => <li key={i} className="error-text">{e}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" onClick={() => setReconfigurer(true)}>Changer les identifiants</button>
              <button type="button" className="btn btn-outline" disabled={saving} onClick={retirer}>Retirer</button>
              {auCabinet && (
                <button type="button" className="btn btn-primary" disabled={syncing} onClick={synchroniser}>
                  {syncing ? 'Synchronisation…' : 'Synchroniser maintenant'}
                </button>
              )}
            </div>
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
