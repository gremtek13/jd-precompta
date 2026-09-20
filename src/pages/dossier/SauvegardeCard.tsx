import { useRef, useState } from 'react'
import { exporterDossier, telechargerSauvegarde, type SauvegardeDossier } from '../../lib/sauvegardeDonnees'
import { messageErreur } from '../../lib/messageErreur'

// La sauvegarde des données d'un dossier, sous forme de fichier qui QUITTE la plateforme.
//
// Elle vit à côté de l'export de pack et de la zone dangereuse parce qu'on y vient pour la même
// raison — mettre quelque chose à l'abri avant qu'il arrive malheur — mais les deux ne protègent pas
// de la même chose, et l'écran doit le dire : un pack contient les FICHIERS (les justificatifs), une
// sauvegarde contient les LIGNES (catégories, écritures, rapprochements, factures). Ni l'un ni
// l'autre ne suffit seul, et c'est la confusion la plus coûteuse qu'on puisse laisser s'installer ici.
export default function SauvegardeCard({ dossierId, dossierNom }: { dossierId: string; dossierNom: string }) {
  const [enCours, setEnCours] = useState(false)
  const [progression, setProgression] = useState<{ fait: number; total: number; table: string } | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [resultat, setResultat] = useState<{ nom: string; sauvegarde: SauvegardeDossier } | null>(null)
  // Un verrou d'exécution est un ref, jamais un état : `setEnCours(true)` ne prend effet qu'au rendu
  // suivant, si bien que deux clics rapprochés entreraient tous deux dans le traitement.
  const verrou = useRef(false)

  async function sauvegarder() {
    if (verrou.current) return
    verrou.current = true
    setEnCours(true)
    setErreur(null)
    setResultat(null)
    try {
      const sauvegarde = await exporterDossier(dossierId, (fait, total, table) =>
        setProgression({ fait, total, table }),
      )
      const nom = await telechargerSauvegarde(sauvegarde)
      setResultat({ nom, sauvegarde })
    } catch (err) {
      setErreur(messageErreur(err, 'La sauvegarde a échoué.'))
    } finally {
      verrou.current = false
      setEnCours(false)
      setProgression(null)
    }
  }

  const manifeste = resultat?.sauvegarde.manifeste
  const totalLignes = manifeste ? Object.values(manifeste.lignesParTable).reduce((s, n) => s + n, 0) : 0

  return (
    <div className="card" style={{ maxWidth: 640, marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Sauvegarde des données</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Télécharge sur ton ordinateur toutes les LIGNES de "{dossierNom}" — catégories, pièces,
        mouvements bancaires, écritures, factures, cotisations, rapprochements — dans un seul fichier
        JSON lisible tel quel. C'est ce qui permettrait de reconstruire le dossier si ce compte
        Supabase devenait inaccessible.
      </p>
      <p className="muted">
        <strong>À ne pas confondre avec un pack.</strong> Un pack contient les fichiers
        (les justificatifs eux-mêmes) ; cette sauvegarde contient les données qui les relient. Il faut
        les deux pour repartir de zéro.
      </p>
      {/* Le fichier porte le client_secret Super PDP du dossier et le texte OCR intégral des pièces,
          qui sur un dossier de santé contient des noms de patients et des numéros de sécurité
          sociale. Le dire ici, au moment du téléchargement, plutôt que dans une documentation que
          personne n'ouvre juste avant de déposer le fichier quelque part. */}
      <p className="muted">
        <strong>Ce fichier est confidentiel.</strong> Il contient les identifiants Super PDP du
        dossier et le texte intégral lu sur chaque pièce — donc, sur un dossier de santé, des données
        de patients. Il se range comme se rangerait le dossier papier du client.
      </p>

      {erreur && <p className="error-text">{erreur}</p>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" onClick={sauvegarder} disabled={enCours}>
          {enCours ? 'Sauvegarde…' : 'Télécharger la sauvegarde'}
        </button>
        {progression && (
          <span className="muted">
            {progression.fait} / {progression.total}
            {progression.table && ` — ${progression.table}`}
          </span>
        )}
      </div>

      {manifeste && (
        <div style={{ marginTop: 14 }}>
          <p style={{ marginBottom: 6 }}>
            <strong>{resultat!.nom}</strong> — {totalLignes.toLocaleString('fr-FR')} ligne
            {totalLignes > 1 ? 's' : ''} sur {Object.keys(manifeste.lignesParTable).length} tables.
          </p>

          {/* Un liens perdu n'empêche pas d'écrire le fichier, mais il empêchera de le restaurer :
              autant l'apprendre maintenant, tant qu'il est encore temps de comprendre pourquoi. */}
          {manifeste.liensPerdus.length > 0 && (
            <p className="error-text">
              {manifeste.liensPerdus.length} lien(s) de cette sauvegarde pointent une ligne qu'elle ne
              contient pas — elle ne pourra pas être restaurée en l'état. Premier :{' '}
              {manifeste.liensPerdus[0].table}.{manifeste.liensPerdus[0].colonne} →{' '}
              {manifeste.liensPerdus[0].parent}.
            </p>
          )}

          <details>
            <summary className="muted">Ce que ce fichier ne contient pas</summary>
            <ul className="muted" style={{ marginTop: 8 }}>
              {manifeste.horsPerimetre.map((ligne) => (
                <li key={ligne}>{ligne}</li>
              ))}
              {manifeste.comptes.obligatoires.length > 0 && (
                <li>
                  La restauration exigera {manifeste.comptes.obligatoires.length} compte(s)
                  utilisateur(s) existants : sans eux, les accès clients, les affectations d'équipe et
                  l'historique des packs ne se réinsèrent pas.
                </li>
              )}
            </ul>
          </details>
        </div>
      )}
    </div>
  )
}
