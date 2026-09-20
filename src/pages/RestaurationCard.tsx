import { useRef, useState, type ChangeEvent } from 'react'
import { restaurerSauvegarde, verifierRestauration, type SauvegardeDossier } from '../lib/sauvegardeDonnees'
import { lireSauvegarde } from '../lib/sauvegardeFichier'
import { messageErreur } from '../lib/messageErreur'

// La restauration d'une sauvegarde, réservée au super-admin.
//
// Pourquoi ici et pas dans l'écran d'un dossier : on restaure un dossier qui n'existe plus, donc il
// n'y a aucun écran de dossier où mettre le bouton. Et pourquoi réservée : c'est la seule action de
// l'application qui écrive des milliers de lignes d'un coup, dans une base dont on n'a pas forcément
// vérifié que c'est la bonne.
//
// Le fichier est LU et VÉRIFIÉ avant d'offrir quoi que ce soit — empreinte, cohérence avec son
// manifeste, liens, comptes exigés. Ce que l'écran montre alors n'est pas un résumé décoratif : c'est
// ce qui permet de reconnaître qu'on tient le bon fichier et la bonne base avant d'écrire.
export default function RestaurationCard() {
  const [sauvegarde, setSauvegarde] = useState<SauvegardeDossier | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [resultat, setResultat] = useState<string | null>(null)
  const verrou = useRef(false)

  async function choisirFichier(e: ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0]
    // Réinitialiser AVANT toute attente : sans ça, un second fichier refusé laisserait à l'écran le
    // résumé du premier, et on croirait tenir une sauvegarde valide.
    setSauvegarde(null)
    setErreur(null)
    setResultat(null)
    if (!fichier) return
    try {
      setSauvegarde(await lireSauvegarde(await fichier.text()))
    } catch (err) {
      setErreur(messageErreur(err, 'Ce fichier ne peut pas être lu.'))
    }
  }

  async function restaurer() {
    if (!sauvegarde || verrou.current) return
    verrou.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const bilan = await restaurerSauvegarde(sauvegarde)
      const ecrites = Object.values(bilan.lignesParTable).reduce((s, n) => s + n, 0)
      // Le verdict ne vient pas du compteur d'écriture mais d'une RELECTURE du dossier restauré :
      // un compteur ne mesure que ce que le code croit avoir fait.
      const ecarts = await verifierRestauration(sauvegarde)
      setResultat(
        ecarts.length === 0
          ? `Restauration vérifiée : ${ecrites} ligne(s) réinsérées, ${bilan.partageesConservees} ligne(s) partagée(s) déjà présentes laissées telles quelles, ${bilan.liensReposes} lien(s) reposé(s). La relecture du dossier correspond exactement à la sauvegarde.`
          : null,
      )
      if (ecarts.length > 0) {
        setErreur(
          `Restauration terminée mais INCOMPLÈTE : ${ecarts.length} écart(s) à la relecture. ` +
            ecarts.slice(0, 3).map((e) => `${e.table} ${e.motif} (${e.identite})`).join(', ') +
            (ecarts.length > 3 ? '…' : ''),
        )
      }
    } catch (err) {
      setErreur(messageErreur(err, 'La restauration a échoué.'))
    } finally {
      verrou.current = false
      setEnCours(false)
    }
  }

  const m = sauvegarde?.manifeste
  const total = m ? Object.values(m.lignesParTable).reduce((s, n) => s + n, 0) : 0

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Restaurer une sauvegarde</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Réinsère les lignes d'un dossier depuis un fichier de sauvegarde. La restauration refuse
        d'écrire par-dessus un dossier existant, refuse un fichier abîmé, et refuse d'effacer un lien
        pour aboutir — un rapprochement bancaire perdu en silence coûte plus cher qu'un refus.
      </p>

      <input type="file" accept="application/json,.json" onChange={choisirFichier} disabled={enCours} />

      {erreur && <p className="error-text" style={{ whiteSpace: 'pre-wrap' }}>{erreur}</p>}
      {resultat && <p style={{ color: 'var(--color-success, inherit)' }}>{resultat}</p>}

      {m && (
        <div style={{ marginTop: 14 }}>
          <p style={{ marginBottom: 6 }}>
            <strong>{m.dossierNom || m.dossierId}</strong> — sauvegarde du{' '}
            {new Date(m.faiteLe).toLocaleString('fr-FR')}, {total.toLocaleString('fr-FR')} ligne(s) sur{' '}
            {Object.keys(m.lignesParTable).length} tables.
          </p>
          <p className="muted" style={{ marginTop: 0 }}>
            Cabinet {m.cabinetId} — il doit déjà exister dans cette base, la sauvegarde ne le contient
            pas.
          </p>

          {m.comptes.obligatoires.length > 0 && (
            <p className="muted">
              {m.comptes.obligatoires.length} compte(s) utilisateur(s) doivent exister : sans eux, la
              restauration s'arrêtera sur les accès clients, les affectations d'équipe ou les packs.
            </p>
          )}

          <details>
            <summary className="muted">Le détail, table par table</summary>
            <ul className="muted" style={{ marginTop: 8, columns: 2 }}>
              {Object.entries(m.lignesParTable)
                .filter(([, n]) => n > 0)
                .map(([table, n]) => (
                  <li key={table}>
                    {table} : {n}
                  </li>
                ))}
            </ul>
          </details>

          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 10 }}
            onClick={restaurer}
            disabled={enCours}
          >
            {enCours ? 'Restauration…' : `Restaurer « ${m.dossierNom || m.dossierId} » dans cette base`}
          </button>
        </div>
      )}
    </div>
  )
}
