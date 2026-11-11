import { useRef, useState } from 'react'
import { formatDate, formatMoney } from '../../lib/format'
import { DEPOT_DES_HONORAIRES_PREVU } from '../../lib/depotDesHonoraires'
import { confirmationDuDepot, lignesDuDepot, motsDeLEtat, type LigneDuDepot } from '../../lib/depotDesHonorairesVue'
import { deposerChezLeClient, useDepotDesHonoraires } from '../../lib/depotDesHonorairesLecture'
import { useDesignationDuDossier } from '../../lib/dossierDuCabinetLecture'
import type { FactureEmise } from '../../lib/types'

// « HONORAIRES DÉPOSÉS CHEZ LES CLIENTS » (ligne 47, LM8), dans l'onglet Factures du DOSSIER DU CABINET seul, côté cabinet,
// derrière `DEPOT_DES_HONORAIRES_PREVU` (baissé : rien ne se monte, rien ne se lit). Chaque facture d'honoraires validée dit
// son état — « À déposer », « Déposée le … », ou à déposer de nouveau quand la pièce a été retirée du dossier du client
// (LM8-Q1) — et offre « Déposer chez le client » sur un clic (LM-Q8) : la confirmation nomme ce qui part et chez qui, le
// refus du module se dit avant le clic, sous un verrou `useRef` relâché après la relecture. Les factures (celles de l'onglet),
// les dépôts, les liens, les lettres et les dossiers du cabinet se lisent EN ENTIER ; lus en partie, refusés ou pas encore
// revenus, la carte le dit et n'offre AUCUN geste. Récit : HISTORIQUE.md, « 11/11/2026 — LM8 : LE DÉPÔT DES HONORAIRES, À
// L'ÉCRAN ».

/** Les factures de l'onglet : `null` tant qu'elles se lisent ; `motif` non nul, lues en partie ou refusées. */
export type FacturesDeLOnglet = { factures: readonly FactureEmise[]; motif: string | null } | null

export default function DepotDesHonorairesCard(p: { dossierId: string; lues: FacturesDeLOnglet }) {
  if (!DEPOT_DES_HONORAIRES_PREVU) return null
  return <Carte {...p} />
}

function Carte({ dossierId, lues }: { dossierId: string; lues: FacturesDeLOnglet }) {
  const [relecture, setRelecture] = useState(0)
  const designation = useDesignationDuDossier(dossierId, 0)
  const designee = designation?.dossierId === dossierId ? designation : null
  const cabinetId = designee?.etat === 'lue' && designee.dossierActuel === dossierId ? designee.cabinetId : null
  const lu = useDepotDesHonoraires(dossierId, cabinetId, relecture)
  const lecture = lu?.dossierId === dossierId ? lu : null
  const [avis, setAvis] = useState<{ dossierId: string; erreur: string | null; fait: string | null } | null>(null)
  const depotEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)

  // Pas encore lue : rien. Un autre dossier que celui du cabinet : la carte n'existe pas.
  if (designee === null) return null
  if (designee.etat === 'illisible') {
    return (
      <section className="card">
        <h3>Honoraires déposés chez les clients</h3>
        <p className="error-text">On ne sait pas si ce dossier est celui du cabinet ({designee.motif}) : le dépôt des honoraires n’est pas offert.</p>
      </section>
    )
  }
  if (designee.dossierActuel !== dossierId) return null

  const erreur = avis?.dossierId === dossierId ? avis.erreur : null
  const fait = avis?.dossierId === dossierId ? avis.fait : null

  async function deposer(ligne: LigneDuDepot, factures: readonly FactureEmise[]) {
    if (depotEnCours.current) return
    depotEnCours.current = true
    setEnCours(true)
    try {
      const facture = factures.find((f) => f.id === ligne.facture.id)
      const origine = ligne.facture.facture_origine_id === null ? null
        : factures.find((f) => f.id === ligne.facture.facture_origine_id)?.numero ?? null
      if (!facture) {
        setAvis({ dossierId, erreur: 'La facture n’est plus dans la liste lue : rien n’a été déposé.', fait: null })
        return
      }
      const issue = await deposerChezLeClient({ dossierId, facture, numeroDeLOrigine: origine, dossierClientId: ligne.clientId })
      setAvis({
        dossierId, erreur: issue.ok ? null : issue.message,
        fait: issue.ok ? `${ligne.facture.type === 'avoir' ? 'Avoir' : 'Facture'} ${ligne.facture.numero ?? ''} déposé${ligne.facture.type === 'avoir' ? '' : 'e'} chez « ${ligne.nomDuClient ?? '—'} »` : null,
      })
    } finally {
      setRelecture((n) => n + 1)
      depotEnCours.current = false
      setEnCours(false)
    }
  }

  const entete = <h3>Honoraires déposés chez les clients</h3>
  if (lues === null || lecture === null) return <section className="card">{entete}<p className="muted">Chargement…</p></section>
  if (lues.motif !== null || lecture.etat === 'illisible') {
    const motif = lues.motif ?? (lecture.etat === 'illisible' ? lecture.motif : '')
    return (
      <section className="card">
        {entete}
        <p className="error-text">Les factures d’honoraires et leurs dépôts n’ont pas pu être lus en entier ({motif}) : aucun dépôt n’est offert.</p>
      </section>
    )
  }
  const factures = lues.factures
  const lignes = lignesDuDepot({
    factures: factures.map((f) => ({
      id: f.id, type: f.type, statut: f.statut, mentions_figees: f.mentions_figees === true, numero: f.numero,
      facture_origine_id: f.facture_origine_id, date_emission: f.date_emission, montant_ttc: f.montant_ttc,
    })),
    liens: lecture.liens, lettres: lecture.lettres, dossiers: lecture.dossiers, depots: lecture.depots,
  })

  return (
    <section className="card">
      {entete}
      <p className="muted">
        Une facture d’honoraires validée se dépose, sur un clic, dans le dossier de son client : une copie en PDF tirée de ses
        valeurs figées, comme une pièce d’achat « à valider ». Il faut avoir accès aux deux dossiers.
      </p>
      {erreur && <p className="error-text">{erreur}</p>}
      {fait && <p className="success-text">{fait}</p>}
      {lignes.length === 0 ? <p className="muted">Aucune facture d’honoraires validée.</p> : (
        <div className="table-scroll tableau-adaptable">
          <table className="table-empilable">
            <thead><tr><th>Numéro</th><th>Date</th><th>Client</th><th>Montant TTC</th><th>État</th><th></th></tr></thead>
            <tbody>
              {lignes.map((ligne) => (
                <tr key={ligne.facture.id}>
                  <td data-libelle="Numéro">{ligne.facture.type === 'avoir' ? 'Avoir ' : ''}{ligne.facture.numero ?? '—'}</td>
                  <td data-libelle="Date">{formatDate(ligne.facture.date_emission)}</td>
                  <td data-libelle="Client">{ligne.nomDuClient ?? <span className="muted">dossier non lu</span>}</td>
                  <td data-libelle="Montant TTC">{formatMoney(ligne.facture.montant_ttc)}</td>
                  <td data-libelle="État">{motsDeLEtat(ligne.etat)}</td>
                  <td data-libelle="">
                    {ligne.etat.etat !== 'chez_le_client' && (
                      <>
                        <button type="button" className="btn btn-outline btn-sm" disabled={enCours || ligne.refus !== null}
                          onClick={() => { if (window.confirm(confirmationDuDepot(ligne))) void deposer(ligne, factures) }}>
                          Déposer chez le client
                        </button>
                        {ligne.refus !== null && <div className="muted">{ligne.refus}</div>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
