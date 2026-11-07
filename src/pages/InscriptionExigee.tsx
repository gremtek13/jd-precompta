import SecuriteDuCompte from './SecuriteDuCompte'

// LA DOUBLE AUTHENTIFICATION EXIGÉE, AVANT TOUT ÉCRAN (C7, second temps ; SEC-Q3) : un compte que le cabinet a exigé et
// qui n'a plus d'application d'authentification (son appareil perdu, le facteur retiré) en inscrit une ici avant que rien
// d'autre ne s'ouvre. La vérification du premier code élève la session à aal2 : la porte s'ouvre alors d'elle-même. La
// base refuse tout le reste à ce compte tant qu'il n'est pas inscrit : cet écran ne lit aucune table.
export default function InscriptionExigee({ espace, email, onDeconnexion }: {
  espace: 'cabinet' | 'client'
  email: string | null
  onDeconnexion: () => void
}) {
  const tu = espace === 'client'
  return (
    <div className="login-shell">
      <div className="login-card">
        <h1>Double authentification exigée</h1>
        <p>
          {tu
            ? `Ton cabinet exige la double authentification pour ${email ?? 'ce compte'} : inscris une application d’authentification pour continuer.`
            : `Votre cabinet exige la double authentification pour ${email ?? 'ce compte'} : inscrivez une application d’authentification pour continuer.`}
        </p>
        <SecuriteDuCompte espace={espace} />
        <button type="button" className="btn btn-sm" onClick={onDeconnexion}>{tu ? 'Me déconnecter' : 'Se déconnecter'}</button>
      </div>
    </div>
  )
}
