import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, NavLink, Outlet, useLocation, useMatch } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../lib/theme'
import { useCabinetBranding } from '../lib/branding'
import { useListeDossiers } from '../lib/listeDossiers'
import {
  IconAccueil, IconApparence, IconComptesMaster, IconDossiers, IconEquipe, IconEstimation,
  IconInformations, IconLogout, IconMoon, IconPanneauLateral, IconPieces, IconPlus, IconPlusOptions,
  IconRecherche, IconSun,
} from './icons'
import Avatar from './widgets/Avatar'
import BarreDossiers from './BarreDossiers'
import BoutonInstallation from './BoutonInstallation'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from './PanneauDroit'

// Barre latérale déployée ou réduite à ses icônes — préférence d'affichage de ce navigateur, pas un
// champ en base : même statut que le thème (voir lib/theme.ts).
const CLE_BARRE_REDUITE = 'jd-precompta-barre-reduite'

function lireBarreReduite(): boolean {
  try {
    return localStorage.getItem(CLE_BARRE_REDUITE) === '1'
  } catch {
    // Stockage indisponible (navigation privée, réglages du navigateur) : la barre s'ouvre déployée.
    return false
  }
}

function retenirBarreReduite(reduite: boolean) {
  try {
    localStorage.setItem(CLE_BARRE_REDUITE, reduite ? '1' : '0')
  } catch {
    // Préférence non retenue : elle vaut pour cette visite, rien de plus.
  }
}

// Coque de l'application, sur ordinateur en trois volets à la manière des applications récentes :
// une barre latérale (navigation, dossiers, compte), le travail au centre dans un panneau posé sur le
// fond, et un panneau contextuel à droite (voir components/PanneauDroit.tsx), qui n'existe que tant
// qu'un écran y affiche quelque chose. Sur mobile rien ne change : barre du haut, navigation fixée en
// bas (voir index.css) ; les éléments propres à l'ordinateur y sont masqués.
//
// Le fournisseur du panneau de droite enveloppe TOUTE la coque : ce qui ouvre le volet vit dans le
// panneau central (l'en-tête d'un dossier), et le volet à côté de lui.
export default function Layout() {
  return (
    <FournisseurPanneauDroit>
      <Coque />
    </FournisseurPanneauDroit>
  )
}

function Coque() {
  const { session, role, isSuperAdmin, estChef, mesSocietes, dossierActifId, setDossierActifId, signOut } = useAuth()
  const libelleRole = role === 'client' ? 'Client' : isSuperAdmin ? 'Super-admin' : estChef ? 'Chef de cabinet' : 'Comptable'
  const { theme, toggleTheme } = useTheme()
  const { pathname } = useLocation()
  // Les entrées du menu du compte, les MÊMES dans le menu du bas de la barre (ordinateur) et dans le
  // menu « … » (téléphone) : les écrire deux fois, c'est attendre le jour où l'un gagne une entrée que
  // l'autre n'a pas. L'apparence du cabinet est réservée au chef, comme sa page ; l'installation
  // s'efface d'elle-même là où elle n'a pas de sens (voir BoutonInstallation). Elle s'installe sous le
  // nom que montre la barre — celui du cabinet quand il a son logo (voir lib/manifesteCabinet.ts).
  function entreesDuCompte(fermer: () => void) {
    return (
      <>
        {role === 'cabinet' && estChef && (
          <NavLink to="/apparence" className={({ isActive }) => `nav-menu-item${isActive ? ' active' : ''}`} onClick={fermer}>
            <IconApparence width={16} height={16} />
            Apparence
          </NavLink>
        )}
        <BoutonInstallation nomApplication={branding?.logoUrl ? branding.nom : 'JD Precompta'} fermerMenu={fermer} />
        <button type="button" className="nav-menu-item" onClick={() => { toggleTheme(); fermer() }}>
          {theme === 'dark' ? <IconSun width={16} height={16} /> : <IconMoon width={16} height={16} />}
          {theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
        </button>
        <button type="button" className="nav-menu-item" onClick={() => { fermer(); signOut() }}>
          <IconLogout width={16} height={16} />
          Déconnexion
        </button>
      </>
    )
  }
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
  // l'autre. On la masque donc uniquement là (voir .app-nav-en-dossier dans la media query mobile) —
  // le lien "← Tableau de bord" en haut de DossierDetail reste le chemin de retour vers cette nav.
  const dansUnDossier = pathname !== '/dossiers' && pathname.startsWith('/dossiers/')

  // Le dossier ouvert et son écran, lus dans l'URL : cette coque est la route PARENTE du dossier, elle
  // ne reçoit pas ses paramètres — `useMatch` les relit sur le chemin courant.
  const correspondance = useMatch('/dossiers/:id/*')
  const idOuvert = correspondance?.params.id ?? null
  const ongletOuvert = correspondance?.params['*'] || null

  const [reduite, setReduite] = useState(lireBarreReduite)
  const [recherche, setRecherche] = useState('')
  const rechercheRef = useRef<HTMLInputElement>(null)

  // Quand relire la liste des dossiers (voir lib/listeDossiers.ts) — décidé PENDANT le rendu, en
  // comparant au rendu précédent, plutôt que dans un effet qui relancerait aussitôt un second rendu.
  // Deux occasions : revenir au tableau de bord, où aboutissent la suppression d'un dossier et ses
  // autres parcours ; et ouvrir un dossier que la liste ne connaît pas (créé ou restauré ailleurs).
  // Chaque identifiant inconnu ne déclenche qu'UNE relecture : un dossier qu'une liste incomplète ne
  // contient pas ne doit pas faire relire en boucle.
  const [cheminPrecedent, setCheminPrecedent] = useState(pathname)
  const [relecture, setRelecture] = useState(0)
  const [idCherche, setIdCherche] = useState<string | null>(null)
  if (pathname !== cheminPrecedent) {
    setCheminPrecedent(pathname)
    if (pathname === '/dossiers') setRelecture((r) => r + 1)
  }
  const liste = useListeDossiers(role === 'cabinet', relecture)
  if (
    role === 'cabinet' && idOuvert && idOuvert !== idCherche && !liste.chargement
    && !liste.dossiers.some((d) => d.id === idOuvert)
  ) {
    setIdCherche(idOuvert)
    setRelecture((r) => r + 1)
  }

  // Deux menus de compte : le « … » de la barre du haut sur mobile, et celui qui s'ouvre sur le bloc
  // utilisateur en bas de la barre latérale sur ordinateur. Chacun se ferme au clic ailleurs.
  const [menuOuvert, setMenuOuvert] = useState(false)
  const [menuCompte, setMenuCompte] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const compteRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function surClicExterieur(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOuvert(false)
      if (compteRef.current && !compteRef.current.contains(e.target as Node)) setMenuCompte(false)
    }
    document.addEventListener('mousedown', surClicExterieur)
    return () => document.removeEventListener('mousedown', surClicExterieur)
  }, [])

  function basculerBarre() {
    const suivante = !reduite
    setReduite(suivante)
    retenirBarreReduite(suivante)
  }

  // La recherche n'existe que dans la barre déployée : la loupe de la barre réduite la déploie d'abord,
  // de façon SYNCHRONE, pour que le champ soit monté au moment où il reçoit le focus.
  function chercherDepuisLaBarreReduite() {
    flushSync(() => setReduite(false))
    retenirBarreReduite(false)
    rechercheRef.current?.focus()
  }

  const email = session?.user.email ?? null

  return (
    <div className={`app-shell${reduite ? ' barre-reduite' : ''}`}>
      <aside className="sidebar">
        <div className="logo">
          {branding?.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.nom} className="brand-logo" />
          ) : (
            <span className="brand-mark">JD</span>
          )}
          <span className="logo-nom">{branding?.logoUrl ? branding.nom : 'JD Precompta'}</span>
          <button
            type="button"
            className="barre-replier"
            onClick={basculerBarre}
            aria-expanded={!reduite}
            aria-label={reduite ? 'Déployer la barre latérale' : 'Réduire la barre latérale'}
            title={reduite ? 'Déployer la barre latérale' : 'Réduire la barre latérale'}
          >
            <IconPanneauLateral width={18} height={18} />
          </button>
        </div>

        {role === 'cabinet' && (
          <Link to="/dossiers?nouveau=1" className="barre-nouveau" title="Nouveau dossier">
            <span className="barre-nouveau-pastille"><IconPlus width={15} height={15} strokeWidth={2.4} /></span>
            <span className="barre-libelle">Nouveau dossier</span>
          </Link>
        )}
        {role === 'cabinet' && !reduite && (
          <label className="barre-recherche">
            <IconRecherche width={16} height={16} />
            <input
              ref={rechercheRef}
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher un dossier"
              aria-label="Rechercher un dossier"
            />
          </label>
        )}
        {role === 'cabinet' && reduite && (
          <button
            type="button"
            className="barre-bouton-rail"
            onClick={chercherDepuisLaBarreReduite}
            aria-label="Rechercher un dossier"
            title="Rechercher un dossier"
          >
            <IconRecherche width={18} height={18} />
          </button>
        )}

        {!masquerNavClient && (
          <nav className={dansUnDossier ? 'app-nav-en-dossier' : undefined}>
            {role === 'cabinet' && (
              // `end` : dans un dossier, c'est le dossier qui est mis en avant dans la barre, pas le
              // tableau de bord qui y mène.
              <NavLink to="/dossiers" end title="Tableau de bord" className={({ isActive }) => (isActive ? 'active' : '')}>
                <IconDossiers width={18} height={18} />
                <span className="nav-label-full">Tableau de bord</span>
                <span className="nav-label-court">Dossiers</span>
              </NavLink>
            )}
            {role === 'cabinet' && estChef && (
              <NavLink to="/equipe" title="Équipe" className={({ isActive }) => (isActive ? 'active' : '')}>
                <IconEquipe width={18} height={18} />
                <span className="nav-label-full">Équipe</span>
                <span className="nav-label-court">Équipe</span>
              </NavLink>
            )}
            {role === 'cabinet' && isSuperAdmin && (
              <NavLink to="/comptes-master" title="Comptes master" className={({ isActive }) => (isActive ? 'active' : '')}>
                <IconComptesMaster width={18} height={18} />
                <span className="nav-label-full">Comptes master</span>
                <span className="nav-label-court">Comptes</span>
              </NavLink>
            )}
            {role === 'client' && (
              <>
                <NavLink to="/accueil" title="Accueil" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <IconAccueil width={18} height={18} />
                  <span className="nav-label-full">Accueil</span>
                  <span className="nav-label-court">Accueil</span>
                </NavLink>
                <NavLink to="/mes-pieces" title="Mes pièces" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <IconPieces width={18} height={18} />
                  <span className="nav-label-full">Mes pièces</span>
                  <span className="nav-label-court">Pièces</span>
                </NavLink>
                <NavLink to="/mes-informations" title="Mes informations" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <IconInformations width={18} height={18} />
                  <span className="nav-label-full">Mes informations</span>
                  <span className="nav-label-court">Infos</span>
                </NavLink>
                <NavLink to="/ma-simulation" title="Ma simulation" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <IconEstimation width={18} height={18} />
                  <span className="nav-label-full">Ma simulation</span>
                  <span className="nav-label-court">Simu</span>
                </NavLink>
              </>
            )}
          </nav>
        )}

        {role === 'cabinet' && (
          <BarreDossiers
            dossiers={liste.dossiers}
            chargement={liste.chargement}
            motif={liste.motif}
            recherche={recherche}
            dossierOuvertId={idOuvert}
            ongletActif={ongletOuvert}
            reduite={reduite}
          />
        )}

        {/* Qui est connecté, en bas de la barre latérale (ordinateur seulement — sur mobile la barre
            du haut n'a pas la place ; le menu "…" porte les mêmes entrées). Un clic ouvre le menu du
            compte : apparence du cabinet, installation, thème et déconnexion, rangés là plutôt qu'en
            boutons permanents. */}
        {email && (
          <div className="sidebar-user" ref={compteRef}>
            <button
              type="button"
              className="barre-compte"
              onClick={() => setMenuCompte((v) => !v)}
              aria-expanded={menuCompte}
              aria-label={`Compte de ${email}`}
              title={email}
            >
              <Avatar nom={email.split('@')[0].replace(/[._-]+/g, ' ')} taille={32} />
              <span className="sidebar-user-texte barre-libelle">
                <span className="sidebar-user-nom">{email}</span>
                <span className="sidebar-user-role">{libelleRole}</span>
              </span>
            </button>
            {menuCompte && (
              <div className="options-menu options-menu-compte">
                {entreesDuCompte(() => setMenuCompte(false))}
              </div>
            )}
          </div>
        )}

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
              {entreesDuCompte(() => setMenuOuvert(false))}
            </div>
          )}
        </div>
      </aside>
      <main className="main">
        <div className="main-contenu">
          {/* Sélecteur de société — un client avec plusieurs dossiers (plusieurs sociétés suivies par
              le même cabinet) n'en voyait jusqu'ici que le premier : dossierIds[0] était utilisé partout
              côté client sans jamais proposer de changer. Dans le contenu plutôt que la barre latérale,
              pour un comportement responsive identique sur mobile (barre du haut) et ordinateur, sans
              traitement CSS à part. Masqué pour un client à une seule société (cas le plus courant). */}
          {role === 'client' && mesSocietes.length > 1 && (
            <div className="selecteur-societe">
              <label htmlFor="selecteur-societe">Société</label>
              <select
                id="selecteur-societe"
                value={dossierActifId ?? ''}
                onChange={(e) => setDossierActifId(e.target.value)}
              >
                {mesSocietes.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
              </select>
            </div>
          )}
          {/* Une société, un montage. Changer de société ne quitte pas l'écran (même route), et un
              écran client resté monté gardait l'état de la précédente : ses réponses dans le
              formulaire de « Mes informations », qu'« Enregistrer » écrivait dans la nouvelle — ou
              une lecture de la précédente, plus lente, arrivée après celle de la nouvelle. La clé
              fait repartir l'écran de zéro ; une réponse de l'ancien montage n'écrit plus nulle part. */}
          <Outlet key={role === 'client' ? dossierActifId ?? '' : undefined} />
        </div>
      </main>
      <EmplacementPanneauDroit />
    </div>
  )
}
