import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { aujourdHuiSql, formatMoney } from '../lib/format'
import { ecartPct, projectionAnnuelle } from '../lib/estimation'
import type { CotisationDeclaree, Piece, ReferenceAnnuelle, ReferencePosteAnnuel } from '../lib/types'
import { lireTout } from '../lib/lectureComplete'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'

// Vue client, lecture seule, de l'estimation indicative que le cabinet tient dans EstimationTab —
// mêmes chiffres, mêmes règles de calcul (lib/estimation.ts, un seul endroit si elles changent), mais
// sans les formulaires de saisie manuelle, l'import de 2035 ni les panneaux de diagnostic : ce sont
// des outils de travail du cabinet, pas quelque chose à manipuler depuis le téléphone d'un client. Le
// client voit où il en est, il ne modifie rien ici — cohérent avec le reste de l'app côté client
// (dépôt de pièces mis à part, rien ne s'écrit sans un clic explicite du cabinet).
export default function ClientSimulation() {
  const { dossierActifId } = useAuth()
  const dossierId = dossierActifId
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  // À part : « aucun repère » ne se dit que d'une liste lue en entier. Vide faute de lecture, elle ne
  // dit rien, et l'affirmer contredirait le bandeau juste au-dessus.
  const [referencesIncompletes, setReferencesIncompletes] = useState(false)
  const [recettesValidees, setRecettesValidees] = useState<Piece[]>([])
  const [references, setReferences] = useState<ReferenceAnnuelle[]>([])
  const [referencesPostes, setReferencesPostes] = useState<ReferencePosteAnnuel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dossierId) return
    async function load() {
      const [lectureCotisations, lectureRecettes, lectureReferences, lectureReferencesPostes] = await Promise.all([
        lireTout<CotisationDeclaree>((debut, fin) =>
          supabase.from('cotisations_declarees').select('*', { count: 'exact' })
            .eq('dossier_id', dossierId).order('id').range(debut, fin),
        ),
        // Lues par tranches : ces recettes FONT le chiffre d'affaires simulé (voir
        // lib/lectureComplete.ts). Tronquées, elles produisent une simulation plausible et basse.
        lireTout<Piece>((debut, fin) =>
          supabase.from('pieces').select('*', { count: 'exact' })
            .eq('dossier_id', dossierId).eq('statut', 'validee').eq('type_piece', 'vente')
            .order('id').range(debut, fin),
        ),
        lireTout<ReferenceAnnuelle>((debut, fin) =>
        supabase.from('references_annuelles').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('annee', { ascending: false }).order('id').range(debut, fin),
      ),
        lireTout<ReferencePosteAnnuel>((debut, fin) =>
        supabase.from('references_postes_annuels').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('annee', { ascending: false }).order('poste').order('id').range(debut, fin),
      ),
      ])
      setCotisations(lectureCotisations.lignes)
      setRecettesValidees(lectureRecettes.lignes)
      setReferences(lectureReferences.lignes)
      setReferencesPostes(lectureReferencesPostes.lignes)
      setReferencesIncompletes(!lectureReferences.complete)
      // Jumelle d'`EstimationTab` : tronquées, ces lectures rendent une simulation plausible et BASSE.
      setLectureIncomplete(
        [lectureCotisations, lectureRecettes, lectureReferences, lectureReferencesPostes]
          .find((l) => !l.complete)?.motif ?? null,
      )
      setLoading(false)
    }
    load()
  }, [dossierId])

  if (!dossierId) {
    return <p className="muted">Aucun dossier ne t'est encore rattaché — contacte JD Consult.</p>
  }
  if (loading) return <p className="muted">Chargement…</p>

  // Relue à chaque rendu, d'UNE date du jour : l'année et les mois écoulés viennent du même instant.
  // Le calcul est celui de l'Estimation du cabinet (lib/estimation.ts) — mêmes chiffres des deux côtés.
  const projection = projectionAnnuelle(recettesValidees, cotisations, aujourdHuiSql())
  const referenceN1 = references.find((r) => r.annee === projection.annee - 1) ?? null

  return (
    <>
      <BandeauLecturePartielle
        quoi="Tes données"
        motif={lectureIncomplete}
        technique={false}
        consequence={
          'Recharge la page : cette simulation peut ne porter que sur une partie de tes recettes et de tes dépenses.'
        }
      />
      <div className="topbar"><h1>Ma simulation</h1></div>

      <div className="brouillon-banner">
        <strong>Estimation indicative</strong> — une projection pour anticiper, pas un calcul officiel de
        régularisation URSSAF ni un substitut à l'avis de l'expert-comptable. Limitée aux charges
        sociales : pour l'impôt sur le revenu, le simulateur des impôts reste plus fiable (il connaît le
        foyer fiscal entier, que ce dossier ne voit jamais).
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Projection {projection.annee}</h3>
        <p className="muted" style={{ marginTop: -8 }}>
          {projection.caProjete === null
            ? "Moins d'un mois s'est écoulé depuis le 1er janvier : la projection s'affichera à la fin janvier."
            : `D'après les ${projection.moisEcoules.toFixed(1).replace('.', ',')} mois écoulés cette année, `
              + 'ramenés à 12 mois — une règle simple, pas une prévision fine.'}
        </p>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <div>
            <span className="muted" style={{ display: 'block' }}>CA encaissé à date</span>
            <strong>{formatMoney(projection.ca)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>CA projeté sur l'année</span>
            <strong>{projection.caProjete === null ? '—' : formatMoney(projection.caProjete)}</strong>
            {projection.caProjete !== null && referenceN1?.chiffre_affaires != null && (
              <span className="muted" style={{ marginLeft: 8 }}>({ecartPct(projection.caProjete, referenceN1.chiffre_affaires)} vs {projection.annee - 1})</span>
            )}
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Cotisations appelées à date</span>
            <strong>{formatMoney(projection.cotis)}</strong>
          </div>
          <div>
            <span className="muted" style={{ display: 'block' }}>Cotisations projetées sur l'année</span>
            <strong>{projection.cotisationsProjetees === null ? '—' : formatMoney(projection.cotisationsProjetees)}</strong>
            {projection.cotisationsProjetees !== null && referenceN1?.total_cotisations_sociales != null && (
              <span className="muted" style={{ marginLeft: 8 }}>({ecartPct(projection.cotisationsProjetees, referenceN1.total_cotisations_sociales)} vs {projection.annee - 1})</span>
            )}
          </div>
        </div>
      </div>

      <h3>Repères annuels</h3>
      <div className="card table-scroll" style={{ padding: 0, marginBottom: 20 }}>
        {references.length === 0 ? (
          <div className="empty-state">
            {referencesIncompletes ? "Tes repères n'ont pas pu être affichés." : "Aucun repère annuel enregistré pour l'instant."}
          </div>
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
