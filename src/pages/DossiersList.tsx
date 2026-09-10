import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { rechercherCodeNaf } from '../lib/sirene'
import { moisEcoulesCetteAnnee } from '../lib/format'
import type { Dossier } from '../lib/types'
import KpiTile from '../components/widgets/KpiTile'
import Widget from '../components/widgets/Widget'
import Avatar from '../components/widgets/Avatar'
import { IconChevron, IconPieces } from '../components/icons'

interface DossierRow extends Dossier {
  nbAValider: number
  moisPresents: number
  moisEcoules: number
  cotisationsOk: boolean
}

interface DepotRecent {
  dossier_id: string
  nom_fichier: string
  created_at: string
  statut: string
}

const ANNEE_COURANTE = new Date().getFullYear()
const MOIS_ECOULES = moisEcoulesCetteAnnee()
const NB_SEMAINES_TENDANCE = 12
const NB_PRIORITES = 6
const NB_ACTIVITES = 8

function debutSemaine(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  // Semaine lundi → dimanche (getDay() renvoie 0 pour dimanche).
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7))
  return r
}

// Dépôts par semaine sur les N dernières semaines (la dernière = semaine en cours) — alimente la
// tendance de la tuile "Pièces à valider" et son delta par rapport à la semaine précédente.
function depotsParSemaine(depots: DepotRecent[], nbSemaines: number): number[] {
  const debutCourante = debutSemaine(new Date()).getTime()
  const semaine = 7 * 24 * 3600 * 1000
  const compteurs = new Array<number>(nbSemaines).fill(0)
  for (const d of depots) {
    const index = nbSemaines - 1 - Math.floor((debutCourante - debutSemaine(new Date(d.created_at)).getTime()) / semaine)
    if (index >= 0 && index < nbSemaines) compteurs[index] += 1
  }
  return compteurs
}

function dateRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const heures = Math.floor(diffMs / 3_600_000)
  if (heures < 1) return "à l'instant"
  if (heures < 24) return `il y a ${heures} h`
  const jours = Math.floor(heures / 24)
  if (jours === 1) return 'hier'
  if (jours < 7) return `il y a ${jours} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

// Dashboard cabinet : ce qui a besoin d'attention sur l'ensemble des dossiers, sans avoir à ouvrir
// chacun pour le savoir. Requêtes globales (pas une par dossier) puis agrégation côté client —
// mêmes signaux que la Checklist de chaque dossier (relevés bancaires de l'année en cours, appels de
// cotisation), volontairement réduits aux deux qui s'appliquent à tous les dossiers sans configuration
// préalable (véhicule, tickets restaurant... restent spécifiques à la Checklist du dossier).
// Présenté en tableau de bord (tuiles chiffrées, priorités, activité récente) puis la liste complète.
export default function DossiersList() {
  const [dossiers, setDossiers] = useState<DossierRow[]>([])
  const [depotsRecents, setDepotsRecents] = useState<DepotRecent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  // Distingue deux pannes possibles (voir audit ergonomie) : la liste des dossiers elle-même
  // (indispensable, rien de fiable à afficher sans elle) et les requêtes d'indicateurs secondaires
  // (pièces à valider, mois couverts, cotisations, dépôts récents) — un échec sur ces dernières ne doit
  // pas cacher la liste, mais ne doit surtout pas non plus se lire comme des zéros rassurants.
  const [erreurChargement, setErreurChargement] = useState<string | null>(null)
  const [erreurIndicateurs, setErreurIndicateurs] = useState(false)
  const navigate = useNavigate()

  async function load() {
    setLoading(true)
    setErreurChargement(null)
    setErreurIndicateurs(false)
    const debutAnnee = `${ANNEE_COURANTE}-01-01`
    const debutTendance = new Date(debutSemaine(new Date()).getTime() - (NB_SEMAINES_TENDANCE - 1) * 7 * 24 * 3600 * 1000).toISOString()

    const [dossiersRes, piecesRes, lignesRes, cotisationsRes, depotsRes] = await Promise.all([
      supabase.from('dossiers').select('*').eq('archive', false).order('nom'),
      supabase.from('pieces').select('dossier_id').eq('statut', 'a_valider'),
      supabase.from('lignes_bancaires').select('dossier_id, date').gte('date', debutAnnee),
      supabase.from('cotisations_declarees').select('dossier_id, echeance').gte('echeance', debutAnnee),
      supabase.from('pieces').select('dossier_id, nom_fichier, created_at, statut').gte('created_at', debutTendance).order('created_at', { ascending: false }),
    ])

    if (dossiersRes.error) {
      setErreurChargement(dossiersRes.error.message)
      setDossiers([])
      setLoading(false)
      return
    }
    if (piecesRes.error || lignesRes.error || cotisationsRes.error || depotsRes.error) {
      setErreurIndicateurs(true)
    }

    const aValider = new Map<string, number>()
    for (const p of piecesRes.data ?? []) aValider.set(p.dossier_id, (aValider.get(p.dossier_id) ?? 0) + 1)

    const moisParDossier = new Map<string, Set<number>>()
    for (const l of lignesRes.data ?? []) {
      const set = moisParDossier.get(l.dossier_id) ?? new Set<number>()
      set.add(new Date(l.date).getMonth() + 1)
      moisParDossier.set(l.dossier_id, set)
    }

    const cotisationsOk = new Set<string>()
    for (const c of cotisationsRes.data ?? []) cotisationsOk.add(c.dossier_id)

    setDossiers(
      (dossiersRes.data ?? []).map((d) => ({
        ...d,
        nbAValider: aValider.get(d.id) ?? 0,
        moisPresents: moisParDossier.get(d.id)?.size ?? 0,
        moisEcoules: MOIS_ECOULES,
        cotisationsOk: cotisationsOk.has(d.id),
      })),
    )
    setDepotsRecents(depotsRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = dossiers.filter((d) => d.nom.toLowerCase().includes(search.toLowerCase()))

  // Un dossier avec au moins un point à régler remonte en premier — inutile de parcourir toute la
  // liste pour repérer ce qui a besoin d'attention.
  const alerte = (d: DossierRow) => d.nbAValider > 0 || d.moisPresents < d.moisEcoules || !d.cotisationsOk
  const trie = [...filtered].sort((a, b) => Number(alerte(b)) - Number(alerte(a)) || a.nom.localeCompare(b.nom))
  const nbAvecAlerte = filtered.filter(alerte).length
  const totalAValider = dossiers.reduce((s, d) => s + d.nbAValider, 0)

  // Priorités : les dossiers en alerte, les plus chargés d'abord (pièces à valider, puis mois manquants).
  const poids = (d: DossierRow) => d.nbAValider * 3 + Math.max(0, d.moisEcoules - d.moisPresents) * 2 + (d.cotisationsOk ? 0 : 1)
  const priorites = dossiers.filter(alerte).sort((a, b) => poids(b) - poids(a) || a.nom.localeCompare(b.nom)).slice(0, NB_PRIORITES)

  const tendanceDepots = depotsParSemaine(depotsRecents, NB_SEMAINES_TENDANCE)
  const semaineCourante = tendanceDepots[tendanceDepots.length - 1] ?? 0
  const semainePrecedente = tendanceDepots[tendanceDepots.length - 2] ?? 0
  const deltaSemaine = semaineCourante - semainePrecedente
  const nomDossier = new Map(dossiers.map((d) => [d.id, d.nom]))
  const activite = depotsRecents.slice(0, NB_ACTIVITES)

  const aujourdhui = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <div className="page-entete">
        <div>
          <h1>Tableau de bord</h1>
          <p className="page-sous-titre" style={{ textTransform: 'capitalize' }}>{aujourdhui}</p>
        </div>
        <div className="page-entete-actions">
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ Nouveau dossier</button>
        </div>
      </div>

      {erreurChargement && (
        <div className="card">
          <div className="empty-state">
            Données indisponibles — impossible de charger la liste des dossiers ({erreurChargement}).
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={load}>Réessayer</button>
            </div>
          </div>
        </div>
      )}

      {loading && !erreurChargement && (
        <div className="bento" aria-busy="true" aria-label="Chargement">
          <div className="skeleton skeleton-kpi span-3" />
          <div className="skeleton skeleton-kpi span-3" />
          <div className="skeleton skeleton-kpi span-3" />
          <div className="skeleton skeleton-kpi span-3" />
          <div className="skeleton skeleton-widget span-8" />
          <div className="skeleton skeleton-widget span-4" />
        </div>
      )}

      {!loading && !erreurChargement && (
        <>
          <div className="bento">
            <div className="span-3">
              <KpiTile libelle="Dossiers suivis" valeur={dossiers.length} detail="hors archivés" />
            </div>
            <div className="span-3">
              <KpiTile
                libelle="À régler"
                valeur={nbAvecAlerte}
                statut={nbAvecAlerte > 0 ? 'warning' : 'ok'}
                detail={nbAvecAlerte > 0 ? 'dossiers avec un point ouvert' : 'aucun point ouvert'}
              />
            </div>
            <div className="span-3">
              <KpiTile libelle="À jour" valeur={dossiers.length - nbAvecAlerte} statut="ok" detail="relevés et cotisations reçus" />
            </div>
            <div className="span-3">
              <KpiTile
                libelle="Pièces à valider"
                valeur={totalAValider}
                statut={totalAValider > 0 ? 'warning' : 'neutral'}
                delta={
                  deltaSemaine === 0
                    ? { texte: 'stable cette semaine' }
                    : { texte: `${deltaSemaine > 0 ? '+' : ''}${deltaSemaine} dépôt(s) vs sem. passée`, positif: deltaSemaine > 0 }
                }
                detail={`${semaineCourante} dépôt(s) cette semaine`}
                tendance={tendanceDepots}
              />
            </div>

            <Widget
              className="span-8"
              titre="À traiter en priorité"
              sousTitre={priorites.length > 0 ? `${nbAvecAlerte} dossier(s) avec un point ouvert — les plus chargés d'abord` : 'Tous les dossiers sont à jour'}
              plein
            >
              {priorites.length === 0 ? (
                <p className="widget-vide" style={{ padding: '10px 20px 20px' }}>Rien à traiter — beau travail.</p>
              ) : (
                <div className="liste-priorites">
                  {/* Toute la ligne est le lien, pas un bouton "Ouvrir" en bout de ligne : sur une
                      largeur de téléphone ce bouton n'a pas la place et se retrouvait masqué, ce qui
                      laissait la ligne sans aucune zone cliquable. */}
                  {priorites.map((d) => (
                    <Link key={d.id} to={`/dossiers/${d.id}`} className="ligne-priorite">
                      <Avatar nom={d.nom} />
                      <div className="ligne-priorite-corps">
                        <div className="ligne-priorite-nom">{d.nom}</div>
                        <div className="ligne-priorite-raisons">
                          {d.nbAValider > 0 && <span className="badge badge-warning">{d.nbAValider} pièce(s) à valider</span>}
                          {d.moisEcoules > 0 && d.moisPresents < d.moisEcoules && (
                            <span className="badge badge-warning">{d.moisEcoules - d.moisPresents} relevé(s) manquant(s)</span>
                          )}
                          {!d.cotisationsOk && <span className="badge badge-neutral">cotisations {ANNEE_COURANTE} absentes</span>}
                        </div>
                      </div>
                      <IconChevron width={18} height={18} className="ligne-chevron" />
                    </Link>
                  ))}
                </div>
              )}
            </Widget>

            <Widget className="span-4" titre="Activité récente" sousTitre="Derniers dépôts de pièces" plein>
              {activite.length === 0 ? (
                <p className="widget-vide" style={{ padding: '10px 20px 20px' }}>Aucun dépôt ces {NB_SEMAINES_TENDANCE} dernières semaines.</p>
              ) : (
                <div className="feed">
                  {/* Chaque dépôt renvoie vers les pièces du dossier concerné — une ligne qui nomme un
                      dossier doit y mener, surtout sur mobile où c'est la seule zone tactile. */}
                  {activite.map((p, i) => (
                    <Link key={`${p.created_at}-${i}`} to={`/dossiers/${p.dossier_id}/pieces`} className="feed-item">
                      <span className="feed-icone"><IconPieces width={16} height={16} /></span>
                      <div className="feed-texte">
                        <strong>{nomDossier.get(p.dossier_id) ?? 'Dossier'}</strong>
                        <span className="feed-fichier">{p.nom_fichier}</span>
                      </div>
                      <span className="feed-date">{dateRelative(p.created_at)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Widget>
          </div>

          {erreurIndicateurs && (
            <p className="error-text" style={{ marginBottom: 14 }}>
              Certains indicateurs (pièces, relevés bancaires, cotisations ou activité) n'ont pas pu être chargés —
              les chiffres concernés peuvent être incomplets le temps de ce chargement.{' '}
              <button type="button" className="btn btn-outline btn-sm" onClick={load}>Réessayer</button>
            </p>
          )}

          <Widget
            titre="Tous les dossiers"
            sousTitre={`${filtered.length} dossier(s)${search ? ' correspondant à la recherche' : ''}`}
            action={<input className="recherche" placeholder="Rechercher un dossier…" value={search} onChange={(e) => setSearch(e.target.value)} />}
            plein
          >
            <div className="table-scroll">
              {filtered.length === 0 ? (
                <div className="empty-state">{search ? 'Aucun dossier ne correspond.' : "Aucun dossier pour l'instant."}</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Dossier</th>
                      <th>Pièces</th>
                      <th className="hide-mobile">Relevés {ANNEE_COURANTE}</th>
                      <th className="hide-mobile">Cotisations {ANNEE_COURANTE}</th>
                      <th className="col-ouvrir"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trie.map((d) => (
                      <tr key={d.id} className="clickable" onClick={() => navigate(`/dossiers/${d.id}`)}>
                        <td>
                          <div className="cellule-identite">
                            <Avatar nom={d.nom} taille={32} />
                            <span className="cellule-identite-nom">{d.nom}</span>
                          </div>
                        </td>
                        <td>
                          {d.nbAValider > 0 ? (
                            <span className="badge badge-warning">{d.nbAValider} à valider</span>
                          ) : (
                            <span className="badge badge-ok">à jour</span>
                          )}
                        </td>
                        <td className="hide-mobile">
                          {/* En janvier, moisEcoules vaut 0 (aucun mois révolu pour l'instant) — pas de division
                              par zéro à afficher, juste rien à attendre encore. */}
                          {d.moisEcoules === 0 ? (
                            <span className="muted" style={{ fontSize: '0.8rem' }}>Aucun mois écoulé</span>
                          ) : (
                            <div className="jauge" style={{ maxWidth: 160 }}>
                              <div className="jauge-segments">
                                {Array.from({ length: d.moisEcoules }, (_, i) => (
                                  <span key={i} className={`jauge-segment ${i < d.moisPresents ? 'ok' : 'manque'}`} />
                                ))}
                              </div>
                              <div className="jauge-legende"><span>{d.moisPresents}/{d.moisEcoules} mois</span></div>
                            </div>
                          )}
                        </td>
                        <td className="hide-mobile">
                          {d.cotisationsOk ? (
                            <span className="badge badge-ok">reçues</span>
                          ) : (
                            <span className="badge badge-warning">aucune</span>
                          )}
                        </td>
                        <td className="col-ouvrir">
                          {/* Bouton sur ordinateur, simple chevron sur mobile (voir index.css) : la
                              ligne entière reste cliquable dans les deux cas, mais un bouton "Ouvrir"
                              mangerait un tiers de la largeur d'un téléphone. */}
                          <Link to={`/dossiers/${d.id}`} className="btn btn-outline btn-sm" onClick={(e) => e.stopPropagation()}>
                            Ouvrir
                          </Link>
                          <IconChevron width={18} height={18} className="ligne-chevron chevron-mobile" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Widget>
        </>
      )}

      {showNew && <NewDossierModal onClose={() => setShowNew(false)} onCreated={load} />}
    </>
  )
}

function NewDossierModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [nom, setNom] = useState('')
  const [siret, setSiret] = useState('')
  const [contactNom, setContactNom] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codeNaf, setCodeNaf] = useState<string | null>(null)
  const [libelleNaf, setLibelleNaf] = useState<string | null>(null)
  const [detectingNaf, setDetectingNaf] = useState(false)

  // Détection best-effort de la profession dès que le SIRET est complet (14 chiffres) — voir
  // lib/sirene.ts. Jamais bloquant : un échec laisse juste le champ vide, à compléter plus tard.
  async function detecterNaf() {
    setCodeNaf(null)
    setLibelleNaf(null)
    if (siret.replace(/\D/g, '').length !== 14) return
    setDetectingNaf(true)
    const infos = await rechercherCodeNaf(siret)
    setDetectingNaf(false)
    if (infos) {
      setCodeNaf(infos.codeNaf)
      setLibelleNaf(infos.libelleNaf)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error } = await supabase.from('dossiers').insert({
      nom,
      siret: siret || null,
      contact_nom: contactNom || null,
      contact_email: contactEmail || null,
      code_naf: codeNaf,
      libelle_naf: libelleNaf,
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onCreated()
    onClose()
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(420px, 92vw)' }}>
        <h2 style={{ marginTop: 0 }}>Nouveau dossier</h2>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="nom">Nom du client</label>
            <input id="nom" required value={nom} onChange={(e) => setNom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="siret">SIRET</label>
            <input id="siret" value={siret} onChange={(e) => setSiret(e.target.value)} onBlur={detecterNaf} />
            {detectingNaf && <span className="muted" style={{ fontSize: '0.82rem' }}>Détection de la profession…</span>}
            {!detectingNaf && (libelleNaf || codeNaf) && (
              <span className="muted" style={{ fontSize: '0.82rem' }}>
                Profession détectée : {libelleNaf ?? `code NAF ${codeNaf}`}
              </span>
            )}
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="contactNom">Contact</label>
              <input id="contactNom" value={contactNom} onChange={(e) => setContactNom(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="contactEmail">Email contact</label>
              <input id="contactEmail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Création…' : 'Créer'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
}
