import { useRef, useState } from 'react'
import documentation from '../../../DOCUMENTATION_DES_TRAITEMENTS.md?raw'
import { fabriquerLePaquet, nomDuPaquet, type PisteDuPaquet } from '../../lib/paquetDArchive'
import { la2035DuPaquet } from '../../lib/paquetDArchive2035'
import { lireLePaquet } from '../../lib/paquetDArchiveLecture'
import { messageErreur } from '../../lib/messageErreur'
import { enregistrerLePaquetTelecharge } from '../../lib/departDuClientLecture'

// LE PAQUET D'ARCHIVE D'UN EXERCICE VALIDÉ, SUR UN CLIC DU CABINET (ligne 44, INAL3a). Monté par l'onglet Écritures — un
// onglet du cabinet, que l'espace client ne monte jamais —, à côté de « Exporter FEC (validé) » : c'est là que le FEC de
// l'exercice validé se relit des colonnes figées, et le paquet porte CE fichier-là (`fec`, calculé au clic). La lecture
// (lib/paquetDArchiveLecture.ts) vérifie l'empreinte puis lit tout en entier ; la fabrication (lib/paquetDArchive.ts, pur)
// relit chaque original à son empreinte. Un refus de l'une ou de l'autre se dit, et rien ne se télécharge.
//
// Verrou `useRef` posé avant le `try`, relâché dans le `finally` : deux clics ne fabriquent qu'un paquet.
//
// Une pièce citée sans empreinte de dépôt entre au paquet marquée « non vérifiée » (INAL3-Q1) : le bouton le dit AVANT le
// clic (`sansEmpreinte`, compté par l'onglet sur les pièces qu'il a lues, `piecesSansEmpreinte`), et le message qui suit le
// téléchargement redit le nombre que la fabrication a compté.
//
// La piste d'audit (INAL3c) est celle de l'onglet, produite au clic (`pisteAudit`) : refusée, aucun paquet. Le PDF de la 2035
// se remplit depuis l'instantané relu par la lecture du paquet (lib/paquetDArchive2035.ts) : s'il ne se fait pas, le paquet
// part sans lui, le manifeste le dit, et le message qui suit le téléchargement aussi.

export default function PaquetDArchiveBouton({ dossierId, dossierSiret, annee, fec, pisteAudit, indisponible, sansEmpreinte }: {
  dossierId: string
  dossierSiret: string | null
  annee: number
  // Le FEC de l'exercice validé, tel que « Exporter FEC (validé) » le télécharge ; nul s'il ne peut pas se calculer.
  fec: () => { nom: string; contenu: string } | null
  // La piste d'audit de l'exercice, telle que « Exporter la piste d'audit » la télécharge ; ne lève pas (un refus est un état).
  pisteAudit: () => Promise<PisteDuPaquet>
  // Pourquoi le FEC ne peut pas encore se calculer (une lecture partielle de l'onglet), ou nul.
  indisponible: string | null
  // Le nombre de pièces citées par l'exercice qui n'ont pas d'empreinte de dépôt, sans valeur par défaut.
  sansEmpreinte: number
}) {
  const fabricationEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [fait, setFait] = useState<{ fichiers: number; nonVerifiees: number; empreinte: string; avis2035: string | null } | null>(null)

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
      const piste = await pisteAudit()
      const pdf2035 = await la2035DuPaquet(lecture.exercice.declaration, annee)
      const paquet = await fabriquerLePaquet({
        exercice: lecture.exercice, piecesCitees: lecture.piecesCitees, originaux: lecture.originaux,
        fec: leFec, pisteAudit: piste, pdf2035, documentation, fabriqueLe: new Date(),
      })
      if (!paquet.ok) {
        setErreur(paquet.message)
        return
      }
      telechargerOctets(nomDuPaquet(dossierSiret, annee), paquet.zip)
      setFait({
        fichiers: paquet.fichiers.length, nonVerifiees: paquet.nonVerifiees, empreinte: paquet.empreinteDuManifeste,
        avis2035: paquet.avisDuPdf2035,
      })
      // Le téléchargement s'enregistre APRÈS la remise au navigateur (ligne 44, INAL5) : la suppression du dossier l'exige,
      // exercice par exercice, à l'empreinte que le paquet scelle. Un enregistrement refusé se dit : le fichier est là, mais
      // la base ne le sait pas. Rien ne s'écrit le drapeau `DEPART_DU_CLIENT_PREVU` baissé.
      const enregistre = await enregistrerLePaquetTelecharge({
        dossierId, annee, empreinteExercice: lecture.exercice.empreinte, empreinteDuManifeste: paquet.empreinteDuManifeste,
        fichiers: paquet.fichiers.length + 1, nonVerifiees: paquet.nonVerifiees,
      })
      if (!enregistre.ok) {
        setErreur(`Le paquet est téléchargé, mais la base ne l’a pas enregistré (${enregistre.message}) : la suppression du dossier `
          + 'l’attendra. Relance le paquet.')
      }
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
        title={indisponible ?? 'Le FEC, la piste d’audit, la 2035 validée (en JSON et en PDF), les originaux des pièces citées (chacun relu à son empreinte), la documentation des traitements et un manifeste, dans un ZIP à garder hors de l’application.'}
        onClick={fabriquer}
      >
        {enCours ? 'Paquet en cours…' : `Paquet d’archive ${annee}`}
      </button>
      {sansEmpreinte > 0 && !fait && (
        <p className="muted" style={{ flexBasis: '100%' }}>
          {sansEmpreinte} pièce(s) citée(s) par l’exercice {annee} n’ont pas d’empreinte de dépôt : elles entreront au paquet
          d’archive marquées « non vérifiée », leur original n’étant pas relu à une empreinte.
        </p>
      )}
      {erreur && <p className="error-text" role="alert" style={{ flexBasis: '100%' }}>{erreur}</p>}
      {fait && (
        <p className="muted" style={{ flexBasis: '100%' }}>
          Paquet d’archive téléchargé : {fait.fichiers} fichier(s)
          {fait.nonVerifiees > 0 ? `, dont ${fait.nonVerifiees} original(aux) non vérifié(s) (sans empreinte de dépôt)` : ' vérifié(s)'},
          manifeste d’empreinte
          {' '}<span style={{ fontFamily: 'monospace' }}>{fait.empreinte.slice(0, 16)}…</span>
        </p>
      )}
      {fait?.avis2035 && (
        <p role="status" style={{ flexBasis: '100%', color: 'var(--color-warning)' }}>Attention : {fait.avis2035}</p>
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
