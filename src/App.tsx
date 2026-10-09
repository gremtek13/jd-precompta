import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { lireRetourDuLien, type RetourDuLien } from './lib/recuperationMotDePasse'
import Layout from './components/Layout'
import Login from './pages/Login'
import NouveauMotDePasse from './pages/NouveauMotDePasse'
import DossiersList from './pages/DossiersList'
import DossierDetail from './pages/DossierDetail'
import ClientHome from './pages/ClientHome'
import ClientUpload from './pages/ClientUpload'
import ClientInformations from './pages/ClientInformations'
import ClientSimulation from './pages/ClientSimulation'
import SuperAdminPage from './pages/SuperAdminPage'
import EquipePage from './pages/EquipePage'
import CabinetBrandingPage from './pages/CabinetBrandingPage'
import RetourBanque from './pages/RetourBanque'

// Un lien « Mot de passe oublié » refusé (expiré, déjà servi) alors qu'une AUTRE session est ouverte dans ce
// navigateur : il se dit avant l'application, sans fermer la session en place.
function LienSansEffet({ avis, email, onContinuer, onDeconnexion }: {
  avis: string
  email: string | null
  onContinuer: () => void
  onDeconnexion: () => void
}) {
  return (
    <div className="login-shell">
      <div className="card login-card">
        <div className="brand-mark brand-mark-lg" style={{ margin: '0 auto' }}>JD</div>
        <h1>Lien de réinitialisation</h1>
        <p className="error-text" role="alert">{avis}</p>
        <p className="muted" style={{ margin: '12px 0 20px' }}>
          {email ? `Tu es connecté avec le compte ${email}.` : 'Tu es déjà connecté.'} Pour recevoir un nouveau lien,
          déconnecte-toi, puis choisis « Mot de passe oublié ? ».
        </p>
        <button className="btn btn-primary" type="button" onClick={onContinuer} style={{ width: '100%' }}>
          Continuer
        </button>
        <button className="btn btn-outline btn-sm" type="button" onClick={onDeconnexion} style={{ marginTop: 14 }}>
          Se déconnecter
        </button>
      </div>
    </div>
  )
}

function Gate() {
  const {
    session, role, isSuperAdmin, estChef, loading, signOut,
    recuperation, terminerRecuperation, avisDuLien, oublierAvisDuLien,
  } = useAuth()
  const navigate = useNavigate()

  // Le fragment d'un lien d'authentification n'est pas une route. Le client le vide lui-même quand il ouvre la
  // session ; il le LAISSE quand le lien est refusé, ou quand son jeton n'a pas pu être vérifié. Une fois la session
  // connue, le client en a fini avec l'adresse : on la remplace, pour que ni l'erreur ni un jeton n'y restent.
  useEffect(() => {
    if (!loading && lireRetourDuLien(window.location.href).nature !== 'aucun') navigate('/', { replace: true })
  }, [loading, navigate])

  // Avant tout autre écran, et avant même les rôles : rien de l'application ne s'ouvre tant que le mot de passe n'est
  // pas choisi.
  if (recuperation) {
    return <NouveauMotDePasse email={session?.user.email ?? null} onTermine={terminerRecuperation} onDeconnexion={signOut} />
  }
  if (loading) return <div className="login-shell"><p className="muted">Chargement…</p></div>
  if (!session) return <Login avis={avisDuLien} />
  if (avisDuLien) {
    return <LienSansEffet avis={avisDuLien} email={session.user.email ?? null} onContinuer={oublierAvisDuLien} onDeconnexion={signOut} />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        {role === 'cabinet' && (
          <>
            <Route path="/dossiers" element={<DossiersList />} />
            <Route path="/dossiers/:id" element={<DossierDetail />} />
            {/* L'onglet actif (Pièces, Banque...) fait partie de l'URL — voir DossierDetail — pour que
                le bouton "retour" du navigateur (ex. après avoir ouvert une pièce dans un nouvel
                onglet) revienne au bon endroit plutôt qu'à la liste des dossiers. */}
            <Route path="/dossiers/:id/:tab" element={<DossierDetail />} />
            {isSuperAdmin && <Route path="/comptes-master" element={<SuperAdminPage />} />}
            {estChef && <Route path="/equipe" element={<EquipePage />} />}
            {estChef && <Route path="/apparence" element={<CabinetBrandingPage />} />}
            {/* Le retour de la banque après son accord (connexion bancaire) : `public/retour-banque.html`
                y recopie les paramètres que la banque a mis dans l'adresse. */}
            <Route path="/retour-banque" element={<RetourBanque />} />
            <Route path="*" element={<Navigate to="/dossiers" replace />} />
          </>
        )}
        {role === 'client' && (
          <>
            <Route path="/accueil" element={<ClientHome />} />
            <Route path="/mes-pieces" element={<ClientUpload />} />
            <Route path="/mes-informations" element={<ClientInformations />} />
            <Route path="/ma-simulation" element={<ClientSimulation />} />
            <Route path="*" element={<Navigate to="/accueil" replace />} />
          </>
        )}
      </Route>
    </Routes>
  )
}

// `retourDuLien` : ce que l'adresse portait au chargement de la page, lu par main.tsx avant le premier rendu.
export default function App({ retourDuLien }: { retourDuLien: RetourDuLien }) {
  return (
    // HashRouter plutôt que BrowserRouter : GitHub Pages est un hébergeur de fichiers statiques sans
    // routage côté serveur. Avec BrowserRouter, rafraîchir sur une route imbriquée (ex. /dossiers/:id)
    // fait une vraie requête HTTP que GitHub Pages ne sait pas résoudre → 404. Avec HashRouter, tout
    // ce qui suit le # (ex. /#/dossiers/xxx) reste côté navigateur, jamais envoyé au serveur.
    <HashRouter>
      <AuthProvider retourDuLien={retourDuLien}>
        <Gate />
      </AuthProvider>
    </HashRouter>
  )
}
