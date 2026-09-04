import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatMoney } from '../lib/format'
import { ecartPct, totauxPourAnnee } from '../lib/estimation'
import type { CotisationDeclaree, Piece, ReferenceAnnuelle, ReferencePosteAnnuel } from '../lib/types'

const ANNEE_COURANTE = new Date().getFullYear()

// Vue client, lecture seule, de l'estimation indicative que le cabinet tient dans EstimationTab —
// mêmes chiffres, mêmes règles de calcul (lib/estimation.ts, un seul endroit si elles changent), mais
// sans les formulaires de saisie manuelle, l'import de 2035 ni les panneaux de diagnostic : ce sont
// des outils de travail du cabinet, pas quelque chose à manipuler depuis le téléphone d'un client. Le
// client voit où il en est, il ne modifie rien ici — cohérent avec le reste de l'app côté client
// (dépôt de pièces mis à part, rien ne s'écrit sans un clic explicite du cabinet).
export default function ClientSimulation() {
  const { dossierIds } = useAuth()
  const dossierId = dossierIds[0]
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [references, setReferences] = useState<ReferenceAnnuelle[]>([])
  const [referencesPostes, setReferencesPostes] = useState<ReferencePosteAnnuel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dossierId) return
    async function load() {
      const [{ data: cotisationsData }, { data: piecesData }, { data: referencesData }, { data: referencesPostesData }] = await Promise.all([
        supabase.from('cotisations_declarees').select('*').eq('dossier_id', dossierId),
        supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'validee').eq('type_piece', 'vente'),
        supabase.from('references_annuelles').select('*').eq('dossier_id', dossierId).order('annee', { ascending: false }),
        supabase.from('references_postes_annuels').select('*').eq('dossier_id', dossierId).order('annee', { ascending: false }).order('poste'),
      ])
      setCotisations(cotisationsData ?? [])
      setPieces(piecesData ?? [])
      setReferences(referencesData ?? [])
      setReferencesPostes(referencesPostesData ?? [])
      setLoading(false)
    }
    load()
  }, [dossierId])

  if (!dossierId) {
    return <p className="muted">Aucun dossier ne t'est encore rattaché — contacte JD Consult.</p>
  }
  if (loading) return <p className="muted">Chargement…</p>

  const moisEcoules = new Date().getMonth() + 1
  const { ca: caAnneeEnCours, cotis: cotisationsAnneeEnCours } = totauxPourAnnee(pieces, cotisations, ANNEE_COURANTE)
  const caProjete = (caAnneeEnCours * 12) / moisEcoules
  const cotisationsProjetees = (cotisationsAnneeEnCours * 12) / moisEcoules
  const referenceN1 = references.find((r) => r.annee === ANNEE_COURANTE - 1) ?? null

  return (
    <>
      <div className="topbar"><h1>Ma simulation</h1></div>

      <div className="brouillon-banner">
        <strong>Estimation indicative</strong> — une projection pour anticiper, pas un calcul officiel de
        régularisation URSSAF ni un substitut à l'avis de l'expert-comptable. Limitée aux charges
        sociales : pour l'impôt sur le revenu, le simulateur des impôts reste plus fiable (il connaît le
        foyer fiscal entier, que ce dossier ne voit jamais).
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Projection {ANNEE_COURANTE}</h3>
        <p className="muted" style={{ marginTop: -8 }}>
          D'après les {moisEcoules} mois déjà entamés cette année, ramenés à 12 mois — une règle simple,
          pas une prévision fine.
        </p>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <div>
            <span className="muted" style={{ display: 'block' }}>CA encaissé à date</span>
            <strong>{formatMoney(caAnneeEnCours)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>CA projeté sur l'année</span>
            <strong>{formatMoney(caProjete)}</strong>
            {referenceN1?.chiffre_affaires != null && (
              <span className="muted" style={{ marginLeft: 8 }}>({ecartPct(caProjete, referenceN1.chiffre_affaires)} vs {ANNEE_COURANTE - 1})</span>
            )}
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Cotisations appelées à date</span>
            <strong>{formatMoney(cotisationsAnneeEnCours)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Cotisations projetées sur l'année</span>
            <strong>{formatMoney(cotisationsProjetees)}</strong>
            {referenceN1?.total_cotisations_sociales != null && (
              <span className="muted" style={{ marginLeft: 8 }}>({ecartPct(cotisationsProjetees, referenceN1.total_cotisations_sociales)} vs {ANNEE_COURANTE - 1})</span>
            )}
          </div>
        </div>
      </div>

      <h3>Repères annuels</h3>
      <div className="card table-scroll" style={{ padding: 0, marginBottom: 20 }}>
        {references.length === 0 ? (
          <div className="empty-state">Aucun repère annuel enregistré pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Année</th><th>Chiffre d'affaires</th><th>Cotisations sociales</th><th>Bénéfice déclaré</th></tr>
            </thead>
            <tbody>
              {references.map((r) => (
                <tr key={r.id}>
                  <td>{r.annee}</td>
                  <td>{r.chiffre_affaires != null ? formatMoney(r.chiffre_affaires) : '—'}</td>
                  <td>{r.total_cotisations_sociales != null ? formatMoney(r.total_cotisations_sociales) : '—'}</td>
                  <td>{r.resultat_net != null ? formatMoney(r.resultat_net) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {referencesPostes.length > 0 && (
        <>
          <h3>Détail par poste</h3>
          <div className="card table-scroll" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Année</th><th>Poste</th><th>Montant</th></tr></thead>
              <tbody>
                {referencesPostes.map((r) => (
                  <tr key={r.id}>
                    <td>{r.annee}</td>
                    <td>{r.poste}</td>
                    <td>{formatMoney(r.montant)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
