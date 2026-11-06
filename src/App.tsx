import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { lireRetourDuLien, type RetourDuLien } from './lib/recuperationMotDePasse'
import Layout from './components/Layout'
import Login from './pages/Login'
import NouveauMotDePasse from './pages/NouveauMotDePasse'
import CodeDeConnexion from './pages/CodeDeConnexion'
import SecuriteDuCompte from './pages/SecuriteDuCompte'
import { etatDeLaSession, facteursDeLaSession, porteDeLApplication } from './lib/doubleAuthentification'
import DossiersList from './pages/DossiersList'
import DossierDetail from './pages/DossierDetail'
import ClientHome from './pages/ClientHome'
import ClientUpload from './pages/ClientUpload'
import ClientInformations from './pages/ClientInformations'
import ClientSimulation from './pages/ClientSimulation'
import ClientVentes from './pages/ClientVentes'
import ClientBanque from './pages/ClientBanque'
import ClientCaisse from './pages/ClientCaisse'
import ClientComptes from './pages/ClientComptes'
import ClientEcheancier from './pages/ClientEcheancier'
import { droitsSur } from './lib/droitsAcces'
import { mesVentesOuvertes } from './lib/espaceVentes'
import { VENTES_DU_CLIENT_EXPORTEES } from './lib/encaissementsFactures'
import { maBanqueOuverte } from './lib/banqueClient'
import { CAISSE_DU_CLIENT_EXPORTEE, maCaisseOuverte } from './lib/caisseClient'
import { mesComptesOuverts, SITUATIONS_PUBLIEES_EXPORTEES } from './lib/situationsPubliees'
import { COUVERTURE_EXPORTEE } from './lib/couvertureReleve'
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
    recuperation, terminerRecuperation, avisDuLien, oublierAvisDuLien, dossierActifId, droitsParDossier,
  } = useAuth()
  const navigate = useNavigate()

  // Le fragment d'un lien d'authentification n'est pas une route. Le client le vide lui-même quand il ouvre la
  // session ; il le LAISSE quand le lien est refusé, ou quand son jeton n'a pas pu être vérifié. Une fois la session
  // connue, le client en a fini avec l'adresse : on la remplace, pour que ni l'erreur ni un jeton n'y restent.
  useEffect(() => {
    if (!loading && lireRetourDuLien(window.location.href).nature !== 'aucun') navigate('/', { replace: true })
  }, [loading, navigate])

  // LE SECOND FACTEUR (ligne 51.5, étape C7) : une session dont le compte a un facteur vérifié et qui n'a pas donné son code
  // n'ouvre aucun écran. La porte se lit sur la session elle-même (son jeton et la copie de l'utilisateur qu'elle porte,
  // lib/doubleAuthentification.ts), dans le rendu : le code donné, auth-js annonce la session élevée et la porte s'ouvre.
  // Rien n'est encore exigé en base (premier temps).
  const porte = session ? porteDeLApplication(etatDeLaSession(session)) : 'ouverte'

  // Avant tout autre écran, et avant même les rôles : rien de l'application ne s'ouvre tant que le mot de passe n'est
  // pas choisi — et, pour un compte qui a un second facteur, tant que son code n'est pas donné (le service refuse alors le
  // changement de mot de passe d'une session `aal1`). Les deux écrans du lien tutoient, comme celui du mot de passe.
  if (recuperation) {
    if (session && porte === 'code') {
      return (
        <CodeDeConnexion
          registre="tu" motif="recuperation" email={session.user.email ?? null}
          facteurs={facteursDeLaSession(session)} onDeconnexion={signOut}
        />
      )
    }
    return <NouveauMotDePasse email={session?.user.email ?? null} onTermine={terminerRecuperation} onDeconnexion={signOut} />
  }
  if (loading) return <div className="login-shell"><p className="muted">Chargement…</p></div>
  if (!session) return <Login avis={avisDuLien} />
  if (avisDuLien) {
    return <LienSansEffet avis={avisDuLien} email={session.user.email ?? null} onContinuer={oublierAvisDuLien} onDeconnexion={signOut} />
  }
  // Après les rôles, pour parler à chacun comme il faut : le cabinet se vouvoie, le client se tutoie.
  if (porte === 'code') {
    return (
      <CodeDeConnexion
        registre={role === 'cabinet' ? 'vous' : 'tu'} motif="connexion" email={session.user.email ?? null}
        facteurs={facteursDeLaSession(session)} onDeconnexion={signOut}
      />
    )
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
            <Route path="/securite" element={<SecuriteDuCompte espace="cabinet" />} />
            <Route path="*" element={<Navigate to="/dossiers" replace />} />
          </>
        )}
        {role === 'client' && (
          <>
            <Route path="/accueil" element={<ClientHome />} />
            <Route path="/mes-pieces" element={<ClientUpload />} />
            <Route path="/mes-informations" element={<ClientInformations />} />
            <Route path="/ma-simulation" element={<ClientSimulation />} />
            {/* « Mon échéancier » (ligne 51.5, étape C1) : à tout accès client ; les montants, sous « Banque » seulement. */}
            <Route path="/mon-echeancier" element={<ClientEcheancier />} />
            {/* « Mes ventes » (espace client, étape P4a) : seulement si la société AFFICHÉE porte la case « Ventes » — un client
                à plusieurs sociétés peut l'avoir sur l'une et pas sur l'autre. Sans elle, l'adresse renvoie à l'accueil, et
                changer de société pour une qui ne la porte pas y ramène aussi ; la base refuse de toute façon (P2). */}
            {mesVentesOuvertes(VENTES_DU_CLIENT_EXPORTEES, droitsSur(droitsParDossier ?? {}, dossierActifId).ventes) && <Route path="/mes-ventes" element={<ClientVentes />} />}
            {/* « Ma banque » (espace client, étape P9) : de même, seulement si la société AFFICHÉE porte la case « Banque ». */}
            {maBanqueOuverte(COUVERTURE_EXPORTEE, droitsSur(droitsParDossier ?? {}, dossierActifId).banque) && <Route path="/ma-banque" element={<ClientBanque />} />}
            {/* « Ma caisse » (ligne 26.6, étape C12a) : de même, seulement si la société AFFICHÉE porte la case « Caisse ». */}
            {maCaisseOuverte(CAISSE_DU_CLIENT_EXPORTEE, droitsSur(droitsParDossier ?? {}, dossierActifId).caisse) && <Route path="/ma-caisse" element={<ClientCaisse />} />}
            {/* « Mes comptes » (ligne 51.5, étape C4b) : de même, seulement si la société AFFICHÉE porte la case « Comptes ». */}
            {mesComptesOuverts(SITUATIONS_PUBLIEES_EXPORTEES, droitsSur(droitsParDossier ?? {}, dossierActifId).comptes) && <Route path="/mes-comptes" element={<ClientComptes />} />}
            <Route path="/securite" element={<SecuriteDuCompte espace="client" />} />
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
