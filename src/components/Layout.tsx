import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Layout() {
  const { role, signOut } = useAuth()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">JD Precompta</div>
        <nav>
          {role === 'cabinet' && (
            <NavLink to="/dossiers" className={({ isActive }) => (isActive ? 'active' : '')}>
              Dossiers
            </NavLink>
          )}
          {role === 'client' && (
            <NavLink to="/mes-pieces" className={({ isActive }) => (isActive ? 'active' : '')}>
              Mes pièces
            </NavLink>
          )}
        </nav>
        <button className="btn btn-outline btn-sm" onClick={signOut}>Déconnexion</button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
