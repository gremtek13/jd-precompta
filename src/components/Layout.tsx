import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../lib/theme'
import { IconLogout, IconMoon, IconSun } from './icons'

export default function Layout() {
  const { role, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { pathname } = useLocation()
  // Sur l'accueil client, les grosses tuiles (Mes pièces / Mes informations / Prendre une photo)
  // font déjà office de navigation — les mêmes liens en rangée d'onglets au-dessus (repliés en barre
  // horizontale sur mobile, juste sous la salutation) sont redondants et encombrent l'écran. Masqués
  // uniquement là ; toujours visibles depuis les autres écrans client pour revenir ou changer d'onglet.
  const masquerNavClient = role === 'client' && pathname === '/accueil'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">JD Precompta</div>
        {!masquerNavClient && (
          <nav>
            {role === 'cabinet' && (
              <NavLink to="/dossiers" className={({ isActive }) => (isActive ? 'active' : '')}>
                Dossiers
              </NavLink>
            )}
            {role === 'client' && (
              <>
                <NavLink to="/accueil" className={({ isActive }) => (isActive ? 'active' : '')}>
                  Accueil
                </NavLink>
                <NavLink to="/mes-pieces" className={({ isActive }) => (isActive ? 'active' : '')}>
                  Mes pièces
                </NavLink>
                <NavLink to="/mes-informations" className={({ isActive }) => (isActive ? 'active' : '')}>
                  Mes informations
                </NavLink>
              </>
            )}
          </nav>
        )}
        <div className="sidebar-actions" style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
          >
            {theme === 'dark' ? <IconSun width={16} height={16} /> : <IconMoon width={16} height={16} />}
          </button>
          <button className="btn btn-outline btn-sm" onClick={signOut} aria-label="Déconnexion">
            <IconLogout width={15} height={15} /> <span className="btn-label">Déconnexion</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
