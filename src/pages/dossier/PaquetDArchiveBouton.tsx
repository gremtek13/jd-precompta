import { useRef, useState } from 'react'
import documentation from '../../../DOCUMENTATION_DES_TRAITEMENTS.md?raw'
import { fabriquerLePaquet, nomDuPaquet } from '../../lib/paquetDArchive'
import { lireLePaquet } from '../../lib/paquetDArchiveLecture'
import { messageErreur } from '../../lib/messageErreur'

// LE PAQUET D'ARCHIVE D'UN EXERCICE VALIDÉ, SUR UN CLIC DU CABINET (ligne 44, INAL3a). Monté par l'onglet Écritures — un
// onglet du cabinet, que l'espace client ne monte jamais —, à côté de « Exporter FEC (validé) » : c'est là que le FEC de
// l'exercice validé se relit des colonnes figées, et le paquet porte CE fichier-là (`fec`, calculé au clic). La lecture
// (lib/paquetDArchiveLecture.ts) vérifie l'empreinte puis lit tout en entier ; la fabrication (lib/paquetDArchive.ts, pur)
// relit chaque original à son empreinte. Un refus de l'une ou de l'autre se dit, et rien ne se télécharge.
//
// Verrou `useRef` posé avant le `try`, relâché dans le `finally` : deux clics ne fabriquent qu'un paquet.

export default function PaquetDArchiveBouton({ dossierId, dossierSiret, annee, fec, indisponible }: {
  dossierId: string
  dossierSiret: string | null
  annee: number
  // Le FEC de l'exercice validé, tel que « Exporter FEC (validé) » le télécharge ; nul s'il ne peut pas se calculer.
  fec: () => { nom: string; contenu: string } | null
  // Pourquoi le FEC ne peut pas encore se calculer (une lecture partielle de l'onglet), ou nul.
  indisponible: string | null
}) {
  const fabricationEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [fait, setFait] = useState<{ fichiers: number; empreinte: string } | null>(null)

  async function fabriquer() {
    if (fabricationEnCours.current || indisponible !== null) return
    fabricationEnCours.current = true
    setErreur(null)
    setFait(null)
    setEnCours(true)
    try {
      const leFec = fec()
      if (leFec === null) {
        setErreur('Aucun paquet d’archive : le FEC de l’exercice ne peut pas encore se calculer.')
        return
      }
      const lecture = await lireLePaquet(dossierId, annee)
      if (lecture.etat === 'refusee') {
        setErreur(`Aucun paquet d’archive : ${lecture.motif}`)
        return
      }
      const paquet = await fabriquerLePaquet({
        exercice: lecture.exercice, piecesCitees: lecture.piecesCitees, originaux: lecture.originaux,
        fec: leFec, documentation, fabriqueLe: new Date(),
      })
      if (!paquet.ok) {
        setErreur(paquet.message)
        return
      }
      telechargerOctets(nomDuPaquet(dossierSiret, annee), paquet.zip)
      setFait({ fichiers: paquet.fichiers.length, empreinte: paquet.empreinteDuManifeste })
    } catch (e) {
      // Une fabrication qui lève (le FEC, JSZip, le navigateur) se dit : sans ce `catch`, le clic n'aurait rien montré.
      setErreur(`Aucun paquet d’archive : ${messageErreur(e, 'la fabrication a été interrompue.')}`)
    } finally {
      fabricationEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <>
      <button
        className="btn btn-outline btn-sm"
        disabled={enCours || indisponible !== null}
        title={indisponible ?? 'Le FEC, la 2035 validée, les originaux des pièces citées (chacun relu à son empreinte), la documentation des traitements et un manifeste, dans un ZIP à garder hors de l’application.'}
        onClick={fabriquer}
      >
        {enCours ? 'Paquet en cours…' : `Paquet d’archive ${annee}`}
      </button>
      {erreur && <p className="error-text" role="alert" style={{ flexBasis: '100%' }}>{erreur}</p>}
      {fait && (
        <p className="muted" style={{ flexBasis: '100%' }}>
          Paquet d’archive téléchargé : {fait.fichiers} fichier(s) vérifié(s), manifeste d’empreinte
          {' '}<span style={{ fontFamily: 'monospace' }}>{fait.empreinte.slice(0, 16)}…</span>
        </p>
      )}
    </>
  )
}

function telechargerOctets(nomFichier: string, octets: Uint8Array) {
  const blob = new Blob([octets as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
