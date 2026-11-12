import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  COPIE_DES_FICHIERS_PREVUE, copieAAttester, nomDuZipDeLaCopie, PLAFOND_EN_MEMOIRE, rappelDeLaCopie, type LectureDesCopies,
} from '../lib/copieDesFichiers'
import {
  attesterLaCopie, copierLesFichiersDuCabinet, lireLesCopiesDuCabinet, preparerLaCopie,
  type IssueDeLAttestation, type IssueDeLaCopie, type Preparation, type SortieDeLaCopie,
} from '../lib/copieDesFichiersLecture'
import { aujourdHuiAParis } from '../lib/format'
import { PLAFOND_DU_ZIP } from '../lib/zipEnFlux'

// LA COPIE DES FICHIERS SUR UN SUPPORT DU CABINET (INAL6, lignes 20.65 et 44), sur le tableau de bord, HORS de la grille
// (comme les RIB à confirmer) : le rappel (« la dernière copie complète date de plus d'un mois ») pour toute l'équipe du
// cabinet (CFC-Q3 (A)), les gestes au chef seul — la base n'enregistre ni n'atteste une copie que de lui. Sous le drapeau de
// la migration (`COPIE_DES_FICHIERS_PREVUE`) : baissé, rien ne se lit ni ne s'affiche.
//
// Trois gestes (CFC-Q1 (B) et CFC-Q2 (B)) : « Mesurer la copie » dit le volume AVANT le clic qui copie ; « Copier » écrit
// UN ZIP, directement dans le fichier que le chef choisit quand le navigateur le permet (`showSaveFilePicker` : Chrome,
// Edge), sinon en mémoire sous `PLAFOND_EN_MEMOIRE`, refusé au-delà ; « Recharger le manifeste » atteste la copie, qui
// ne compte qu'alors. Chaque geste sous son verrou `useRef`, posé avant le `try`, relâché dans le `finally`.

interface FluxDuDisque { write: (d: Uint8Array<ArrayBuffer>) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> }
interface PoigneeDuDisque { createWritable: () => Promise<FluxDuDisque> }
type ChoisirLeFichier = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<PoigneeDuDisque>

/** L'écriture directe sur le disque (File System Access), si le navigateur l'offre. */
function choisirLeFichier(): ChoisirLeFichier | null {
  const f = (window as unknown as { showSaveFilePicker?: ChoisirLeFichier }).showSaveFilePicker
  return typeof f === 'function' ? f.bind(window) : null
}

async function sortieSurLeDisque(poignee: PoigneeDuDisque): Promise<SortieDeLaCopie> {
  const flux = await poignee.createWritable()
  return {
    plafond: PLAFOND_DU_ZIP,
    ecrire: (m) => flux.write(m as Uint8Array<ArrayBuffer>),
    terminer: () => flux.close(),
    // Le navigateur écrit dans un fichier temporaire : abandonné, le fichier choisi n'est pas créé.
    abandonner: async () => { try { await flux.abort() } catch { /* déjà fermé */ } },
  }
}

function sortieEnMemoire(nom: string): SortieDeLaCopie {
  // Chaque morceau devient un Blob, que le navigateur peut ranger hors du tas de la page ; le Uint8Array s'oublie.
  let morceaux: Blob[] = []
  return {
    plafond: PLAFOND_EN_MEMOIRE,
    ecrire: async (m) => { morceaux.push(new Blob([m as Uint8Array<ArrayBuffer>])) },
    terminer: async () => {
      const url = URL.createObjectURL(new Blob(morceaux, { type: 'application/zip' }))
      morceaux = []
      const a = document.createElement('a')
      a.href = url
      a.download = nom
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Laisser le navigateur prendre le fichier avant de libérer l'adresse.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
    abandonner: async () => { morceaux = [] },
  }
}

function mio(octets: number): string {
  return `${(octets / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mio`
}

export const LIBELLE_MESURER = 'Mesurer la copie des fichiers'
export const LIBELLE_COPIER = 'Copier les fichiers des dossiers en un ZIP'
export const LIBELLE_MANIFESTE = 'Recharger le manifeste (MANIFESTE.txt)'

export default function CopieDesFichiers({ className }: { className?: string }) {
  const { estChef, monCabinetId } = useAuth()
  const [lecture, setLecture] = useState<{ cabinetId: string; lecture: LectureDesCopies } | null>(null)
  const [mesure, setMesure] = useState<{ cabinetId: string; issue: { ok: true; preparation: Preparation } | { ok: false; message: string } } | null>(null)
  const [avancement, setAvancement] = useState<string | null>(null)
  const [issue, setIssue] = useState<IssueDeLaCopie | null>(null)
  const [attestation, setAttestation] = useState<IssueDeLAttestation | null>(null)
  const mesureEnCours = useRef(false)
  const copieEnCours = useRef(false)
  const attestationEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)

  const relire = useCallback(async (cabinetId: string) => {
    const lu = await lireLesCopiesDuCabinet(cabinetId)
    setLecture({ cabinetId, lecture: lu })
  }, [])

  useEffect(() => {
    if (!COPIE_DES_FICHIERS_PREVUE || !monCabinetId) return
    let annule = false
    void lireLesCopiesDuCabinet(monCabinetId).then((lu) => { if (!annule) setLecture({ cabinetId: monCabinetId, lecture: lu }) })
    return () => { annule = true }
  }, [monCabinetId])

  if (!COPIE_DES_FICHIERS_PREVUE || !monCabinetId) return null
  const lue = lecture !== null && lecture.cabinetId === monCabinetId ? lecture.lecture : null
  const rappel = rappelDeLaCopie(lue, aujourdHuiAParis())
  const aAttester = copieAAttester(lue)
  const mesuree = mesure !== null && mesure.cabinetId === monCabinetId ? mesure.issue : null
  const surLeDisque = choisirLeFichier() !== null
  const trop = mesuree !== null && mesuree.ok && !surLeDisque && mesuree.preparation.octets > PLAFOND_EN_MEMOIRE

  async function mesurer() {
    if (mesureEnCours.current || !monCabinetId) return
    mesureEnCours.current = true
    const cabinetId = monCabinetId
    try {
      setEnCours(true)
      setAvancement('Lecture des dossiers…')
      setMesure({ cabinetId, issue: await preparerLaCopie(cabinetId, setAvancement) })
    } finally {
      setAvancement(null)
      setEnCours(false)
      mesureEnCours.current = false
    }
  }

  async function copier() {
    if (copieEnCours.current || !monCabinetId) return
    copieEnCours.current = true
    const cabinetId = monCabinetId
    try {
      setEnCours(true)
      setIssue(null)
      setAttestation(null)
      const fabriqueLe = new Date()
      const choisir = choisirLeFichier()
      let sortie: SortieDeLaCopie
      if (choisir) {
        // Avant toute attente : le navigateur n'ouvre le choix du fichier que dans le geste du clic.
        let poignee: PoigneeDuDisque
        try {
          poignee = await choisir({ suggestedName: nomDuZipDeLaCopie(fabriqueLe), types: [{ description: 'Archive ZIP', accept: { 'application/zip': ['.zip'] } }] })
        } catch {
          setIssue({ ok: false, message: 'Copie annulée : aucun fichier n’a été choisi.' })
          return
        }
        sortie = await sortieSurLeDisque(poignee)
      } else {
        sortie = sortieEnMemoire(nomDuZipDeLaCopie(fabriqueLe))
      }
      setAvancement('Lecture des dossiers…')
      const resultat = await copierLesFichiersDuCabinet(cabinetId, {
        sortie, maintenant: () => fabriqueLe, identifiant: () => crypto.randomUUID(), avancement: setAvancement,
      })
      setIssue(resultat)
      await relire(cabinetId)
    } catch {
      setIssue({ ok: false, message: 'La copie n’a pas pu commencer : le fichier choisi ne s’ouvre pas en écriture.' })
    } finally {
      setAvancement(null)
      setEnCours(false)
      copieEnCours.current = false
    }
  }

  async function attester(e: ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0] ?? null
    e.target.value = ''
    if (attestationEnCours.current || !monCabinetId || !aAttester || !fichier) return
    attestationEnCours.current = true
    const cabinetId = monCabinetId
    try {
      setEnCours(true)
      setAttestation(await attesterLaCopie(cabinetId, aAttester, fichier))
      await relire(cabinetId)
    } finally {
      setEnCours(false)
      attestationEnCours.current = false
    }
  }

  const pastille = rappel.genre === 'rappel' ? 'check-attention' : rappel.genre === 'a_jour' ? 'check-neutre' : null
  return (
    <section className={`avis-rib copie-des-fichiers${rappel.genre === 'rappel' ? ' avis-rib-attente' : ' avis-rib-discret'}${className ? ` ${className}` : ''}`}
      aria-label="Copie des fichiers sur un support du cabinet">
      {pastille && <span className={`check-dot ${pastille}`} aria-hidden="true" />}
      <div className="avis-rib-corps">
        {rappel.genre === 'rien'
          ? <p className="avis-rib-phrase muted">Lecture de la dernière copie des fichiers…</p>
          : <p className={`avis-rib-phrase${rappel.genre === 'illisible' ? ' muted' : ''}`}
            title={rappel.genre === 'illisible' ? rappel.motif : undefined}>{rappel.phrase}</p>}
        {estChef && (
          <>
            <p className="avis-rib-texte">
              Tous les fichiers des dossiers du cabinet — pièces de tout exercice, documents, originaux des factures reprises —,
              chacun relu à son empreinte, en un seul ZIP avec son manifeste. À ranger sur un disque ou un espace du cabinet,
              jamais sur Google Drive. La copie ne compte qu’une fois son manifeste rechargé ici.
            </p>
            <p className="avis-rib-texte muted">
              {surLeDisque
                ? `Ce navigateur écrit le ZIP directement dans le fichier que vous choisirez : la mémoire n’en garde qu’un fichier à la fois (au plus ${mio(PLAFOND_DU_ZIP)} et 65 535 fichiers).`
                : `Ce navigateur garde le ZIP en mémoire jusqu’à la fin : ${mio(PLAFOND_EN_MEMOIRE)} au plus. Au-delà, ouvrir l’application dans Chrome ou Edge sur un ordinateur, qui l’écrivent directement sur le disque.`}
            </p>
            <div className="field-row">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void mesurer()} disabled={enCours}>
                {LIBELLE_MESURER}
              </button>
              {mesuree !== null && mesuree.ok && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => void copier()} disabled={enCours || trop}>
                  {enCours ? 'En cours…' : LIBELLE_COPIER}
                </button>
              )}
            </div>
            {mesuree !== null && !mesuree.ok && <p className="avis-rib-texte" role="alert">{mesuree.message}</p>}
            {mesuree !== null && mesuree.ok && (
              <p className="avis-rib-texte" role={trop ? 'alert' : 'status'}>
                {mesuree.preparation.dossiers} dossier(s), {mesuree.preparation.fichiers} fichier(s),{' '}
                {mesuree.preparation.tailleInconnue > 0 ? 'au moins ' : ''}{mio(mesuree.preparation.octets)}
                {mesuree.preparation.tailleInconnue > 0 ? ` (${mesuree.preparation.tailleInconnue} fichier(s) dont le stockage n’a pas dit la taille)` : ''}.
                {trop ? ` C’est plus que les ${mio(PLAFOND_EN_MEMOIRE)} que ce navigateur fabrique en mémoire : la copie ne part pas d’ici.` : ''}
              </p>
            )}
            {aAttester && (
              <div className="field-row">
                <label className="btn btn-outline btn-sm">
                  {LIBELLE_MANIFESTE}
                  <input type="file" accept=".txt,text/plain" hidden aria-label={LIBELLE_MANIFESTE}
                    onChange={(e) => void attester(e)} disabled={enCours} />
                </label>
              </div>
            )}
          </>
        )}
        {avancement && <p className="avis-rib-texte muted" role="status">{avancement}</p>}
        {issue && !issue.ok && <p className="avis-rib-texte" role="alert">{issue.message}</p>}
        {issue && issue.ok && (
          <div className="avis-rib-texte" role="status">
            <p>
              Un ZIP de {mio(issue.bilan.octetsDuZip)} pour {issue.bilan.dossiers} dossier(s) : {issue.bilan.fichiers} fichier(s),
              dont {issue.bilan.verifies} vérifié(s) à leur empreinte, {issue.bilan.nonVerifies} sans empreinte en base.
            </p>
            {(issue.bilan.ecarts > 0 || issue.bilan.manquants > 0) && (
              <p role="alert">
                {issue.bilan.ecarts} écart(s) d’empreinte et {issue.bilan.manquants} fichier(s) manquant(s) : le manifeste les
                nomme. La copie n’est pas complète ; à signaler sans attendre.
              </p>
            )}
            <ul>{issue.bilan.repartition.map((d) => <li key={d}>{d}</li>)}</ul>
            {issue.bilan.enregistrementRefuse
              ? <p role="alert">Le ZIP est parti, mais la copie ne s’est pas enregistrée : {issue.bilan.enregistrementRefuse}</p>
              : <p>Reste à ranger le ZIP sur un disque ou un espace du cabinet, puis à recharger son MANIFESTE.txt : la copie ne compte qu’alors.</p>}
          </div>
        )}
        {attestation && !attestation.ok && <p className="avis-rib-texte" role="alert">{attestation.message}</p>}
        {attestation && attestation.ok && <p className="avis-rib-texte" role="status">Manifeste reconnu : la copie est attestée.</p>}
      </div>
    </section>
  )
}
