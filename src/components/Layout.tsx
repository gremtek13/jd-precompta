import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../lib/theme'
import { IconLogout, IconMoon, IconPlusOptions, IconSun } from './icons'

export default function Layout() {
  const { role, isSuperAdmin, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { pathname } = useLocation()
  // Sur l'accueil client, les grosses tuiles (Mes pièces / Mes informations / Prendre une photo)
  // font déjà office de navigation — les mêmes liens en rangée d'onglets au-dessus (repliés en barre
  // horizontale sur mobile, juste sous la salutation) sont redondants et encombrent l'écran. Masqués
  // uniquement là ; toujours visibles depuis les autres écrans client pour revenir ou changer d'onglet.
  const masquerNavClient = role === 'client' && pathname === '/accueil'

  // Sur mobile, thème + déconnexion se replient derrière un menu "..." plutôt que deux boutons en
  // permanence à côté du logo et de la nav — la barre du haut était surchargée (voir discussion).
  // Sur ordinateur, les deux boutons restent visibles directement (voir CSS, .sidebar-actions-mobile
  // masquée au-delà de 720px) : aucun changement là où la place ne manque pas.
  const [menuOuvert, setMenuOuvert] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function surClicExterieur(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOuvert(false)
    }
    document.addEventListener('mousedown', surClicExterieur)
    return () => document.removeEventListener('mousedown', surClicExterieur)
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <span className="brand-mark">JD</span>
          JD Precompta
        </div>
        {!masquerNavClient && (
          <nav>
            {role === 'cabinet' && (
              <NavLink to="/dossiers" className={({ isActive }) => (isActive ? 'active' : '')}>
                Dossiers
              </NavLink>
            )}
            {role === 'cabinet' && isSuperAdmin && (
              <NavLink to="/comptes-master" className={({ isActive }) => (isActive ? 'active' : '')}>
                Comptes master
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
                <NavLink to="/ma-simulation" className={({ isActive }) => (isActive ? 'active' : '')}>
                  Ma simulation
                </NavLink>
              </>
            )}
          </nav>
        )}
        <div className="sidebar-actions">
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

        <div className="sidebar-actions-mobile" ref={menuRef}>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setMenuOuvert((v) => !v)}
            aria-label="Plus d'options"
            aria-expanded={menuOuvert}
          >
            <IconPlusOptions width={16} height={16} />
          </button>
          {menuOuvert && (
            <div className="options-menu">
              <button type="button" className="nav-menu-item" onClick={() => { toggleTheme(); setMenuOuvert(false) }}>
                {theme === 'dark' ? <IconSun width={16} height={16} /> : <IconMoon width={16} height={16} />}
                {theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
              </button>
              <button type="button" className="nav-menu-item" onClick={() => { setMenuOuvert(false); signOut() }}>
                <IconLogout width={16} height={16} />
                Déconnexion
              </button>
            </div>
          )}
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
