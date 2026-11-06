import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  MOTS, etatDuCompte, nomPropose, refusDuCode, refusDuNom, registreDe, secretEnGroupes, type EspaceDuCompte, type Facteur,
} from '../lib/doubleAuthentification'
import {
  actualiserLaSession, inscrireUnAppareil, lireLaSecurite, retirerUnAppareil, verifierLeCode,
  type InscriptionCommencee, type SecuriteLue,
} from '../lib/doubleAuthentificationAppels'
import { formatDate } from '../lib/format'

// « SÉCURITÉ DU COMPTE » (ligne 51.5, étape C7), depuis le menu du compte, au cabinet (vous) comme au client (tu) : les
// appareils inscrits comme second facteur, en ajouter un (le code QR, et la clé à recopier), le confirmer par un code, en
// retirer un après une confirmation qui le nomme. Rien n'est encore exigé : la page le dit. La règle et les mots vivent
// dans lib/doubleAuthentification.ts, les appels dans lib/doubleAuthentificationAppels.ts ; chaque geste passe un verrou,
// relâché après la relecture des appareils.

type Lecture = { etat: 'chargement' } | { etat: 'erreur'; message: string } | { etat: 'lue'; securite: SecuriteLue }

function nomAffiche(f: Facteur): string {
  return f.nom || 'Appareil sans nom'
}

export default function SecuriteDuCompte({ espace }: { espace: EspaceDuCompte }) {
  const registre = registreDe(espace)
  const mots = MOTS[registre]
  const [lecture, setLecture] = useState<Lecture>({ etat: 'chargement' })
  // Le nom saisi ; nul tant qu'on n'y a pas touché : le nom proposé, calculé sur les appareils lus.
  const [nomSaisi, setNomSaisi] = useState<string | null>(null)
  const [inscription, setInscription] = useState<(InscriptionCommencee & { nom: string }) | null>(null)
  const [code, setCode] = useState('')
  const [aRetirer, setARetirer] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [avis, setAvis] = useState<string | null>(null)
  const [copie, setCopie] = useState<'faite' | 'ratee' | null>(null)
  const [enCours, setEnCours] = useState(false)
  const verrouSecurite = useRef(false)

  useEffect(() => {
    let annule = false
    void lireLaSecurite(registre).then((issue) => {
      if (!annule) setLecture(issue.ok ? { etat: 'lue', securite: issue.valeur } : { etat: 'erreur', message: issue.message })
    })
    return () => { annule = true }
  }, [registre])

  async function relire() {
    const issue = await lireLaSecurite(registre)
    setLecture(issue.ok ? { etat: 'lue', securite: issue.valeur } : { etat: 'erreur', message: issue.message })
  }

  const facteurs = lecture.etat === 'lue' ? lecture.securite.facteurs : []
  const nom = nomSaisi ?? nomPropose(facteurs)
  const refusNom = refusDuNom(nom, facteurs, registre)
  const refusCode = refusDuCode(code)

  async function ajouter(e: FormEvent) {
    e.preventDefault()
    if (verrouSecurite.current) return
    if (lecture.etat !== 'lue' || refusNom !== null) return
    verrouSecurite.current = true
    setEnCours(true)
    setErreur(null)
    setAvis(null)
    try {
      const issue = await inscrireUnAppareil(nom, registre)
      if (issue.ok) {
        setInscription({ ...issue.valeur, nom: nom.trim() })
        setCode('')
        setCopie(null)
      } else {
        setErreur(issue.message)
      }
      await relire()
    } finally {
      verrouSecurite.current = false
      setEnCours(false)
    }
  }

  async function confirmer(e: FormEvent) {
    e.preventDefault()
    if (verrouSecurite.current) return
    if (inscription === null || refusCode !== null) return
    verrouSecurite.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const issue = await verifierLeCode(inscription.id, code, registre)
      if (issue.ok) {
        setInscription(null)
        setNomSaisi(null)
        setAvis(mots.confirme)
      } else {
        setErreur(issue.message)
        setCode('')
      }
      await relire()
    } finally {
      verrouSecurite.current = false
      setEnCours(false)
    }
  }

  // Abandonner l'inscription commencée : le facteur inachevé se retire (de toute session, documentation de Supabase).
  async function abandonner() {
    if (verrouSecurite.current) return
    if (inscription === null) return
    verrouSecurite.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const issue = await retirerUnAppareil(inscription.id, registre)
      if (issue.ok) setInscription(null)
      else setErreur(issue.message)
      await relire()
    } finally {
      verrouSecurite.current = false
      setEnCours(false)
    }
  }

  async function retirer(facteur: Facteur) {
    if (verrouSecurite.current) return
    verrouSecurite.current = true
    setEnCours(true)
    setErreur(null)
    setAvis(null)
    try {
      const issue = await retirerUnAppareil(facteur.id, registre)
      if (issue.ok) {
        setARetirer(null)
        setAvis(issue.valeur.sessionActualisee
          ? `« ${nomAffiche(facteur)} » est retiré.`
          : `« ${nomAffiche(facteur)} » est retiré ; la session s’actualisera à son prochain renouvellement.`)
      } else {
        setErreur(issue.message)
      }
      await relire()
    } finally {
      verrouSecurite.current = false
      setEnCours(false)
    }
  }

  async function actualiser() {
    if (verrouSecurite.current) return
    verrouSecurite.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const issue = await actualiserLaSession(registre)
      if (!issue.ok) setErreur(issue.message)
      await relire()
    } finally {
      verrouSecurite.current = false
      setEnCours(false)
    }
  }

  // La clé ne part que vers le presse-papiers de l'appareil, sur un clic ; jamais vers un journal.
  async function copier(secret: string) {
    try {
      await navigator.clipboard.writeText(secret)
      setCopie('faite')
    } catch {
      setCopie('ratee')
    }
  }

  const entete = (
    <>
      <div className="topbar"><h1>Sécurité du compte</h1></div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20, maxWidth: 720 }}>{mots.introduction}</p>
    </>
  )

  if (lecture.etat === 'chargement') return <>{entete}<p className="muted">Chargement…</p></>
  if (lecture.etat === 'erreur') {
    return (
      <>
        {entete}
        <p className="error-text" role="alert">{lecture.message}</p>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => { setLecture({ etat: 'chargement' }); void relire() }}>
          Relire
        </button>
      </>
    )
  }

  const etat = etatDuCompte(lecture.securite.niveaux, facteurs)
  // Les gestes ne s'offrent qu'à une session qui dit ce que le service sait ; sinon, l'actualiser d'abord.
  const gestes = etat === 'sans-facteur' || etat === 'verifie'
  const listes = facteurs.filter((f) => f.id !== inscription?.id)
  const confirmes = facteurs.filter((f) => f.verifie)

  return (
    <>
      {entete}
      {!gestes && (
        <div className="card" style={{ maxWidth: 720, marginBottom: 16 }}>
          <p style={{ marginTop: 0 }}>{mots.jetonARafraichir}</p>
          <button type="button" className="btn btn-primary btn-sm" disabled={enCours} onClick={() => void actualiser()}>
            {enCours ? 'Actualisation…' : 'Actualiser la session'}
          </button>
        </div>
      )}
      {avis && <p className="muted" role="status">{avis}</p>}
      {erreur && <p className="error-text" role="alert">{erreur}</p>}

      <section className="card" style={{ maxWidth: 720, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Appareils inscrits</h2>
        {listes.length === 0 ? <p className="muted">{mots.aucunAppareil}</p> : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {listes.map((f) => (
              <li key={f.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <strong>{nomAffiche(f)}</strong>{' '}
                  <span className={`badge ${f.verifie ? 'badge-ok' : 'badge-warning'}`}>{f.verifie ? 'Actif' : 'Inscription inachevée'}</span>
                  <div className="muted">
                    {f.type === 'totp' ? 'Application d’authentification' : f.type} · ajouté le {formatDate(f.creeLe)}
                  </div>
                </div>
                {gestes && aRetirer !== f.id && (
                  <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => { setARetirer(f.id); setAvis(null) }}>
                    Retirer
                  </button>
                )}
                {gestes && aRetirer === f.id && (
                  <div style={{ flexBasis: '100%' }}>
                    <p style={{ margin: '4px 0 8px' }}>
                      {f.verifie
                        ? mots.confirmationRetrait(nomAffiche(f), confirmes.length === 1)
                        : `Retirer l’inscription inachevée « ${nomAffiche(f)} » ?`}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <button type="button" className="btn btn-danger btn-sm" disabled={enCours} onClick={() => void retirer(f)}>
                        {enCours ? 'Retrait…' : `Retirer « ${nomAffiche(f)} »`}
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => setARetirer(null)}>Annuler</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {gestes && (
        <section className="card" style={{ maxWidth: 720 }}>
          <h2 style={{ marginTop: 0 }}>Ajouter un appareil</h2>
          {confirmes.length < 2 && <p className="muted">{mots.conseilSecondAppareil}</p>}
          {inscription === null ? (
            <form onSubmit={ajouter}>
              <div className="field-row aligne-bas" style={{ flexWrap: 'wrap' }}>
                <div className="field">
                  <label htmlFor="appareil-nom">Nom de l’appareil</label>
                  <input id="appareil-nom" value={nom} onChange={(e) => setNomSaisi(e.target.value)} autoComplete="off" />
                </div>
                <button type="submit" className="btn btn-primary" disabled={enCours || refusNom !== null}>
                  {enCours ? 'Ajout…' : 'Ajouter l’appareil'}
                </button>
              </div>
              {refusNom && <p className="muted">{refusNom}</p>}
            </form>
          ) : (
            <form onSubmit={confirmer}>
              <p style={{ marginTop: 0 }}>{mots.scanner}</p>
              <img className="qr-second-facteur" src={inscription.qrCode} alt={`Code QR de l’appareil « ${inscription.nom} »`} />
              <p className="muted" style={{ marginBottom: 4 }}>Clé à saisir dans l’application :</p>
              <p style={{ margin: 0 }}><code className="cle-second-facteur">{secretEnGroupes(inscription.secret)}</code></p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '8px 0 12px' }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => void copier(inscription.secret)}>Copier la clé</button>
                {copie === 'faite' && <span className="muted" role="status">Clé copiée.</span>}
                {copie === 'ratee' && <span className="error-text" role="alert">{mots.copieImpossible}</span>}
              </div>
              <div className="field" style={{ maxWidth: 260 }}>
                <label htmlFor="appareil-code">Code à six chiffres</label>
                <input
                  id="appareil-code" inputMode="numeric" autoComplete="one-time-code"
                  value={code} onChange={(e) => setCode(e.target.value)}
                />
              </div>
              {code !== '' && refusCode && <p className="muted">{refusCode}</p>}
              <p className="muted">{mots.avantConfirmation}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={enCours || refusCode !== null}>
                  {enCours ? 'Vérification…' : `Confirmer « ${inscription.nom} »`}
                </button>
                <button type="button" className="btn btn-outline" disabled={enCours} onClick={() => void abandonner()}>Abandonner</button>
              </div>
            </form>
          )}
        </section>
      )}
    </>
  )
}
