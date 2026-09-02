import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import DossiersList from './pages/DossiersList'
import DossierDetail from './pages/DossierDetail'
import ClientUpload from './pages/ClientUpload'
import ClientInformations from './pages/ClientInformations'

function Gate() {
  const { session, role, loading } = useAuth()

  if (loading) return <div className="login-shell"><p className="muted">Chargement…</p></div>
  if (!session) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        {role === 'cabinet' && (
          <>
            <Route path="/dossiers" element={<DossiersList />} />
            <Route path="/dossiers/:id" element={<DossierDetail />} />
            <Route path="*" element={<Navigate to="/dossiers" replace />} />
          </>
        )}
        {role === 'client' && (
          <>
            <Route path="/mes-pieces" element={<ClientUpload />} />
            <Route path="/mes-informations" element={<ClientInformations />} />
            <Route path="*" element={<Navigate to="/mes-pieces" replace />} />
          </>
        )}
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    // HashRouter plutôt que BrowserRouter : GitHub Pages est un hébergeur de fichiers statiques sans
    // routage côté serveur. Avec BrowserRouter, rafraîchir sur une route imbriquée (ex. /dossiers/:id)
    // fait une vraie requête HTTP que GitHub Pages ne sait pas résoudre → 404. Avec HashRouter, tout
    // ce qui suit le # (ex. /#/dossiers/xxx) reste côté navigateur, jamais envoyé au serveur.
    <HashRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </HashRouter>
  )
}
