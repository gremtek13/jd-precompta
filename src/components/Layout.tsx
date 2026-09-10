import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../lib/theme'
import { useCabinetBranding } from '../lib/branding'
import {
  IconAccueil, IconApparence, IconComptesMaster, IconDossiers, IconEquipe, IconEstimation,
  IconInformations, IconLogout, IconMoon, IconPieces, IconPlusOptions, IconSun,
} from './icons'

export default function Layout() {
  const { role, isSuperAdmin, estChef, mesSocietes, dossierActifId, setDossierActifId, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { pathname } = useLocation()
  // Charte graphique du cabinet (voir lib/branding.ts, CabinetBrandingPage) — appliquée ici pour
  // comptables et clients à la fois, puisque les deux passent par ce même Layout. branding reste null
  // (repli sur le logo/couleur JD Precompta par défaut) pour un cabinet qui n'a rien configuré.
  const branding = useCabinetBranding()
  // Sur l'accueil client, les grosses tuiles (Mes pièces / Mes informations / Prendre une photo)
  // font déjà office de navigation — les mêmes liens en rangée d'onglets au-dessus (repliés en barre
  // horizontale sur mobile, juste sous la salutation) sont redondants et encombrent l'écran. Masqués
  // uniquement là ; toujours visibles depuis les autres écrans client pour revenir ou changer d'onglet.
  const masquerNavClient = role === 'client' && pathname === '/accueil'

  // À l'intérieur d'un dossier, DossierParcours affiche déjà sa propre barre d'onglets fixée en bas
  // sur mobile (voir index.css) — garder aussi celle-ci en bas empilerait deux barres fixes l'une sur
  // l'autre. On la masque donc uniquement là (voir .app-nav-en-dossier dans la media query mobile ;
  // sur ordinateur, où elle reste une simple liste dans la barre latérale, rien ne change) — le lien
  // "← Dossiers" en haut de DossierDetail reste le chemin de retour vers cette nav.
  const dansUnDossier = pathname !== '/dossiers' && pathname.startsWith('/dossiers/')

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
          {branding?.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.nom} className="brand-logo" />
          ) : (
            <span className="brand-mark">JD</span>
          )}
          {branding?.logoUrl ? branding.nom : 'JD Precompta'}
        </div>
        {!masquerNavClient && (
          <nav className={dansUnDossier ? 'app-nav-en-dossier' : undefined}>
            {role === 'cabinet' && (
              <NavLink to="/dossiers" className={({ isActive }) => (isActive ? 'active' : '')}>
                <IconDossiers width={18} height={18} />
                <span className="nav-label-full">Dossiers</span>
                <span className="nav-label-court">Dossiers</span>
              </NavLink>
            )}
            {role === 'cabinet' && estChef && (
              <NavLink to="/equipe" className={({ isActive }) => (isActive ? 'active' : '')}>
                <IconEquipe width={18} height={18} />
                <span className="nav-label-full">Équipe</span>
                <span className="nav-label-court">Équipe</span>
              </NavLink>
            )}
            {role === 'cabinet' && estChef && (
              <NavLink to="/apparence" className={({ isActive }) => (isActive ? 'active' : '')}>
                <IconApparence width={18} height={18} />
                <span className="nav-label-full">Apparence</span>
                <span className="nav-label-court">Apparence</span>
              </NavLink>
            )}
            {role === 'cabinet' && isSuperAdmin && (
              <NavLink to="/comptes-master" className={({ isActive }) => (isActive ? 'active' : '')}>
                <IconComptesMaster width={18} height={18} />
                <span className="nav-label-full">Comptes master</span>
                <span className="nav-label-court">Comptes</span>
              </NavLink>
            )}
            {role === 'client' && (
              <>
                <NavLink to="/accueil" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <IconAccueil width={18} height={18} />
                  <span className="nav-label-full">Accueil</span>
                  <span className="nav-label-court">Accueil</span>
                </NavLink>
                <NavLink to="/mes-pieces" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <IconPieces width={18} height={18} />
                  <span className="nav-label-full">Mes pièces</span>
                  <span className="nav-label-court">Pièces</span>
                </NavLink>
                <NavLink to="/mes-informations" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <IconInformations width={18} height={18} />
                  <span className="nav-label-full">Mes informations</span>
                  <span className="nav-label-court">Infos</span>
                </NavLink>
                <NavLink to="/ma-simulation" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <IconEstimation width={18} height={18} />
                  <span className="nav-label-full">Ma simulation</span>
                  <span className="nav-label-court">Simu</span>
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
        {/* Sélecteur de société — un client avec plusieurs dossiers (plusieurs sociétés suivies par
            le même cabinet) n'en voyait jusqu'ici que le premier : dossierIds[0] était utilisé partout
            côté client sans jamais proposer de changer. Dans le contenu plutôt que la barre latérale,
            pour un comportement responsive identique sur mobile (barre du haut) et ordinateur, sans
            traitement CSS à part. Masqué pour un client à une seule société (cas le plus courant). */}
        {role === 'client' && mesSocietes.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <label htmlFor="selecteur-societe" className="muted" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
              Société :
            </label>
            <select
              id="selecteur-societe"
              value={dossierActifId ?? ''}
              onChange={(e) => setDossierActifId(e.target.value)}
              style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '7px 10px', fontSize: '0.85rem', fontWeight: 600, maxWidth: '100%' }}
            >
              {mesSocietes.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </select>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  )
}
