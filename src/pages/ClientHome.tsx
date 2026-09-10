import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { deposerFichier } from '../lib/depot'
import { comptesParMois, dateRelative, moisEcoulesCetteAnnee } from '../lib/format'
import { IconCamera, IconDocuments, IconEstimation, IconInformations, IconPieces } from '../components/icons'
import KpiTile from '../components/widgets/KpiTile'
import Widget from '../components/widgets/Widget'
import ProgressRing from '../components/widgets/ProgressRing'
import type { CotisationDeclaree, DocumentDivers, Dossier, LigneBancaire, Piece } from '../lib/types'

const CLE_ONBOARDING_VU = 'jd-precompta-client-onboarding-vu'
const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const ANNEE_COURANTE = new Date().getFullYear()
const NB_MOIS_TENDANCE = 12
const NB_DERNIERS_DEPOTS = 5

const LABEL_CATEGORIE: Record<DocumentDivers['categorie'], string> = {
  releve_bancaire: 'Relevé bancaire',
  cotisation: 'Appel de cotisation',
  attestation: 'Attestation / certificat',
  autre: 'Document',
}

// Un dépôt fusionne pieces (factures/reçus) et documents_divers (relevés, cotisations, attestations) —
// même logique que "Mes pièces" (ClientUpload) : le client dépose un fichier, peu importe où il finit
// rangé en base.
interface Depot {
  id: string
  nomFichier: string
  createdAt: string
  label: string
}

// Page d'accueil du client — un point d'entrée doublé d'un petit tableau de bord : la salutation et
// les grandes tuiles d'action d'abord (le geste le plus fréquent est de déposer une facture), puis ce
// que le client a intérêt à savoir sans le demander à son comptable — ce qui est bien arrivé, ce qui
// est en cours de vérification, ce qu'il reste à envoyer. Volontairement limité aux chiffres qu'un
// non-comptable comprend : jamais de solde, de TVA ni de résultat ici.
export default function ClientHome() {
  const { dossierActifId } = useAuth()
  const dossierId = dossierActifId
  const navigate = useNavigate()
  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [pieces, setPieces] = useState<Piece[]>([])
  const [documents, setDocuments] = useState<DocumentDivers[]>([])
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [chargement, setChargement] = useState(true)
  const [onboardingVu, setOnboardingVu] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)

  async function load() {
    if (!dossierId) return
    setChargement(true)
    const [{ data: dossierData }, { data: piecesData }, { data: documentsData }, { data: lignesData }, { data: cotisationsData }] =
      await Promise.all([
        supabase.from('dossiers').select('*').eq('id', dossierId).maybeSingle(),
        supabase.from('pieces').select('*').eq('dossier_id', dossierId).order('created_at', { ascending: false }),
        supabase.from('documents_divers').select('*').eq('dossier_id', dossierId).order('created_at', { ascending: false }),
        supabase.from('lignes_bancaires').select('*').eq('dossier_id', dossierId),
        supabase.from('cotisations_declarees').select('*').eq('dossier_id', dossierId),
      ])
    setDossier(dossierData ?? null)
    setPieces(piecesData ?? [])
    setDocuments(documentsData ?? [])
    setLignes(lignesData ?? [])
    setCotisations(cotisationsData ?? [])
    setChargement(false)
  }

  useEffect(() => { load() }, [dossierId])

  useEffect(() => {
    setOnboardingVu(localStorage.getItem(CLE_ONBOARDING_VU) === '1')
  }, [])

  function masquerOnboarding() {
    localStorage.setItem(CLE_ONBOARDING_VU, '1')
    setOnboardingVu(true)
  }

  // Prise de photo directement depuis l'accueil — même pipeline que "Déposer des fichiers" (Mes
  // pièces) via deposerFichier (lib/depot.ts) : hash anti-doublon, upload, extraction automatique,
  // classement Pièces/Documents. Une fois traité, on renvoie vers "Mes pièces" pour que le client
  // voie tout de suite que sa photo est bien arrivée et où elle a été rangée.
  async function handleCapture(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !dossierId) return
    const file = fileList[0]
    setCapturing(true)
    setCaptureError(null)
    const resultat = await deposerFichier(dossierId, file)
    setCapturing(false)
    if (resultat.statut === 'erreur') {
      setCaptureError(`${file.name} : ${resultat.message}.`)
      return
    }
    if (resultat.statut === 'doublon') {
      setCaptureError(`${file.name} : déjà déposé, pas réenvoyé.`)
      return
    }
    navigate('/mes-pieces')
  }

  if (!dossierId) {
    return <p className="muted">Aucun dossier ne t'est encore rattaché — contacte JD Consult.</p>
  }

  // Juste le prénom si on a un nom complet ("Marie Dupont" → "Marie") — plus chaleureux qu'un nom
  // entier ou qu'un générique "Bonjour" sans rien, mais on ne connaît que ce que le cabinet a saisi.
  const prenom = dossier?.contact_nom?.trim().split(/\s+/)[0]
  const aujourdhui = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  const depots: Depot[] = [
    ...pieces.map((p): Depot => ({
      id: `piece-${p.id}`,
      nomFichier: p.nom_fichier,
      createdAt: p.created_at,
      label: p.statut === 'validee' ? 'Facture traitée' : 'Facture en cours de vérification',
    })),
    ...documents.map((d): Depot => ({
      id: `doc-${d.id}`, nomFichier: d.nom_fichier, createdAt: d.created_at, label: LABEL_CATEGORIE[d.categorie],
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  const depotsAnnee = depots.filter((d) => new Date(d.createdAt).getFullYear() === ANNEE_COURANTE)
  const tendanceDepots = comptesParMois(depots.map((d) => d.createdAt), NB_MOIS_TENDANCE)
  const moisCourant = tendanceDepots[tendanceDepots.length - 1] ?? 0
  const moisPrecedent = tendanceDepots[tendanceDepots.length - 2] ?? 0
  const deltaMois = moisCourant - moisPrecedent

  // "En cours de vérification" : côté cabinet ce sont les pièces à valider. Formulé du point de vue du
  // client, à qui on ne demande rien pour celles-ci — c'est au comptable de jouer.
  const enVerification = pieces.filter((p) => p.statut === 'a_valider').length

  // Mêmes signaux que la Checklist du cabinet et que "Mes pièces", pour que les trois écrans disent la
  // même chose. moisEcoulesCetteAnnee() exclut le mois en cours : inutile de réclamer un relevé pour un
  // mois qui n'est pas fini.
  const moisEcoules = moisEcoulesCetteAnnee()
  const moisPresents = new Set(
    lignes.filter((l) => new Date(l.date).getFullYear() === ANNEE_COURANTE).map((l) => new Date(l.date).getMonth() + 1),
  )
  const moisManquants = Array.from({ length: moisEcoules }, (_, i) => i + 1).filter((m) => !moisPresents.has(m))
  const cotisationsAnnee = cotisations.filter((c) => new Date(c.echeance).getFullYear() === ANNEE_COURANTE)

  const aEnvoyer = [
    {
      id: 'banque',
      label: `Relevés bancaires ${ANNEE_COURANTE}`,
      ok: moisManquants.length === 0,
      detail: moisEcoules === 0
        ? "Aucun mois encore terminé cette année"
        : moisManquants.length > 0
          ? `Mois manquants : ${moisManquants.map((m) => NOMS_MOIS[m - 1]).join(', ')}`
          : `${moisEcoules}/${moisEcoules} mois reçus`,
    },
    {
      id: 'cotisations',
      label: `Appels de cotisation ${ANNEE_COURANTE}`,
      ok: cotisationsAnnee.length > 0,
      detail: cotisationsAnnee.length > 0 ? `${cotisationsAnnee.length} échéance(s) reçue(s)` : "Aucun appel reçu pour l'instant cette année",
    },
    {
      id: 'depots',
      label: `Factures et documents ${ANNEE_COURANTE}`,
      ok: depotsAnnee.length > 0,
      detail: `${depotsAnnee.length} déposé(s) cette année`,
    },
  ]
  const nbEnvoye = aEnvoyer.filter((i) => i.ok).length
  const nbManquant = aEnvoyer.length - nbEnvoye

  return (
    <>
      <section className="client-hero">
        <span className="client-hero-date">{aujourdhui}</span>
        <h1>{prenom ? `Bonjour ${prenom} 👋` : 'Bonjour 👋'}</h1>
        <p className="client-hero-sous">{dossier ? `Ton espace pour ${dossier.nom}` : 'Ton espace'} — dépose, on s'occupe du reste.</p>
      </section>

      <div className="tuiles">
        <label className={`tuile tuile-principale${capturing ? ' tuile-desactivee' : ''}`}>
          <span className="tuile-icone"><IconCamera width={24} height={24} /></span>
          <span className="tuile-libelle">{capturing ? 'Analyse en cours…' : 'Prendre une photo'}</span>
          <span className="tuile-desc">Une facture, un reçu : photographie-le, il est reconnu et classé tout seul.</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            disabled={capturing}
            onChange={(e) => { handleCapture(e.target.files); e.target.value = '' }}
          />
        </label>
        <Link to="/mes-pieces" className="tuile">
          <span className="tuile-icone"><IconDocuments width={24} height={24} /></span>
          <span className="tuile-libelle">Mes pièces</span>
          <span className="tuile-desc">Dépose des fichiers et vois ce qu'il manque encore à ton dossier.</span>
        </Link>
        <Link to="/mes-informations" className="tuile">
          <span className="tuile-icone"><IconInformations width={24} height={24} /></span>
          <span className="tuile-libelle">Mes informations</span>
          <span className="tuile-desc">Véhicule, titres-restaurant, chèques-vacances… à renseigner une fois.</span>
        </Link>
        <Link to="/ma-simulation" className="tuile">
          <span className="tuile-icone"><IconEstimation width={24} height={24} /></span>
          <span className="tuile-libelle">Ma simulation</span>
          <span className="tuile-desc">Une estimation de tes charges sociales à partir de tes chiffres.</span>
        </Link>
      </div>

      {captureError && <p className="error-text" style={{ marginBottom: 16 }}>{captureError}</p>}

      {chargement ? (
        <div className="bento" aria-busy="true" aria-label="Chargement">
          <div className="skeleton skeleton-kpi span-3" />
          <div className="skeleton skeleton-kpi span-3" />
          <div className="skeleton skeleton-kpi span-3" />
          <div className="skeleton skeleton-kpi span-3" />
          <div className="skeleton skeleton-widget span-7" />
          <div className="skeleton skeleton-widget span-5" />
        </div>
      ) : (
        <div className="bento">
          <div className="span-3">
            <KpiTile
              libelle={`Envoyés en ${ANNEE_COURANTE}`}
              valeur={depotsAnnee.length}
              detail="factures et documents"
              delta={
                deltaMois === 0
                  ? { texte: 'comme le mois dernier' }
                  : { texte: `${deltaMois > 0 ? '+' : ''}${deltaMois} vs mois dernier`, positif: deltaMois > 0 }
              }
              tendance={tendanceDepots}
              onClick={() => navigate('/mes-pieces')}
            />
          </div>
          <div className="span-3">
            <KpiTile
              libelle="En cours de vérification"
              valeur={enVerification}
              statut="neutral"
              detail={enVerification > 0 ? 'ton comptable s\'en occupe' : 'tout est traité'}
              onClick={() => navigate('/mes-pieces')}
            />
          </div>
          <div className="span-3">
            <KpiTile
              libelle={`Relevés ${ANNEE_COURANTE}`}
              valeur={moisEcoules === 0 ? '—' : <>{Math.min(moisPresents.size, moisEcoules)}<small>/ {moisEcoules}</small></>}
              statut={moisEcoules === 0 ? 'neutral' : moisManquants.length > 0 ? 'warning' : 'ok'}
              detail={moisEcoules === 0 ? 'rien à envoyer encore' : moisManquants.length > 0 ? `${moisManquants.length} mois à envoyer` : 'tous reçus'}
              onClick={() => navigate('/mes-pieces')}
            />
          </div>
          <div className="span-3">
            <KpiTile
              libelle={`Cotisations ${ANNEE_COURANTE}`}
              valeur={cotisationsAnnee.length}
              statut={cotisationsAnnee.length > 0 ? 'ok' : 'warning'}
              detail={cotisationsAnnee.length > 0 ? 'échéances reçues' : 'aucun appel reçu'}
              onClick={() => navigate('/mes-pieces')}
            />
          </div>

          <Widget
            className="span-7"
            titre="Ce qu'il reste à envoyer"
            sousTitre={nbManquant === 0 ? 'Ton dossier est à jour, rien à faire.' : `${nbManquant} point(s) en attente de ta part`}
            action={
              <ProgressRing
                ratio={nbEnvoye / aEnvoyer.length}
                statut={nbManquant > 0 ? 'warning' : 'ok'}
                taille={56}
                epaisseur={6}
                libelle={`${nbEnvoye} sur ${aEnvoyer.length} points à jour`}
              />
            }
          >
            <div>
              {aEnvoyer.map((item) => (
                <div key={item.id} className="check-ligne">
                  <span className={`check-dot ${item.ok ? '' : 'check-manque'}`} aria-label={item.ok ? 'Reçu' : 'En attente'} />
                  <div className="check-ligne-corps">
                    <div className="check-ligne-libelle">{item.label}</div>
                    <div className="check-ligne-detail">{item.detail}</div>
                  </div>
                  {!item.ok && (
                    <Link to="/mes-pieces" className="btn btn-outline btn-sm">Envoyer</Link>
                  )}
                </div>
              ))}
            </div>
          </Widget>

          <Widget
            className="span-5"
            titre="Mes derniers envois"
            sousTitre="Tout ce que tu as déposé arrive ici"
            action={<Link to="/mes-pieces" className="btn btn-outline btn-sm">Tout voir</Link>}
            plein
          >
            {depots.length === 0 ? (
              <p className="widget-vide" style={{ padding: '10px 20px 20px' }}>
                Rien d'envoyé pour l'instant — commence par une photo d'une facture.
              </p>
            ) : (
              <div className="feed">
                {depots.slice(0, NB_DERNIERS_DEPOTS).map((d) => (
                  <Link key={d.id} to="/mes-pieces" className="feed-item">
                    <span className="feed-icone"><IconPieces width={16} height={16} /></span>
                    <div className="feed-texte">
                      <strong>{d.label}</strong>
                      <span className="feed-fichier">{d.nomFichier}</span>
                    </div>
                    <span className="feed-date">{dateRelative(d.createdAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Widget>
        </div>
      )}

      {!onboardingVu && (
        <div className="widget">
          <header className="widget-entete">
            <div>
              <h3 className="widget-titre">Comment ça marche</h3>
              <p className="widget-sous-titre">Trois étapes, rien à trier de ton côté.</p>
            </div>
            <div className="widget-action">
              <button type="button" className="btn btn-outline btn-sm" onClick={masquerOnboarding}>Compris</button>
            </div>
          </header>
          <div className="widget-corps">
            <div className="etapes">
              <div className="etape">
                <span className="etape-num">1</span>
                <div>
                  <div className="etape-titre">Dépose tes fichiers</div>
                  <div className="etape-desc">Factures, reçus, relevés, appels de cotisation — sans trier.</div>
                </div>
              </div>
              <div className="etape">
                <span className="etape-num">2</span>
                <div>
                  <div className="etape-titre">C'est reconnu automatiquement</div>
                  <div className="etape-desc">Chaque fichier est analysé et classé dès l'envoi.</div>
                </div>
              </div>
              <div className="etape">
                <span className="etape-num">3</span>
                <div>
                  <div className="etape-titre">Suis ce qu'il reste</div>
                  <div className="etape-desc">Le bloc "Ce qu'il reste à envoyer" te dit ce qui manque.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
