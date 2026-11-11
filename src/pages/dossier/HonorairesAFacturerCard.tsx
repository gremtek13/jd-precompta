import { useRef, useState } from 'react'
import { aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import { HONORAIRES_FACTURES_PREVUS, TAUX_DES_HONORAIRES, type FactureDuCabinet } from '../../lib/honorairesAFacturer'
import {
  aFacturerParClient, confirmationDeLaFacturation, libelleDuTaux, motsDeLaFacturee, refusDeLaSelection, type ClientAFacturer,
  type ElementPropose,
} from '../../lib/honorairesAFacturerVue'
import { facturerLesHonoraires, useHonorairesAFacturer } from '../../lib/honorairesAFacturerLecture'
import { useDesignationDuDossier } from '../../lib/dossierDuCabinetLecture'
import type { FacturesDeLOnglet } from './DepotDesHonorairesCard'

// « À FACTURER » (ligne 47, LM7), dans l'onglet Factures du DOSSIER DU CABINET seul, côté cabinet, derrière
// `HONORAIRES_FACTURES_PREVUS` (baissé : rien ne se monte, rien ne se lit). Par client puis par lettre acceptée : les
// périodes de forfait échues (LM7-Q2) et les tâches par exercice (le clic qui les facture les dit faites, LM7-Q1), sous la
// lettre en vigueur au dernier jour (LM7-Q4) ; ce qui est déjà facturé, avec sa facture ; la période qu'un avoir total rend à
// facturer (LM7-Q3). « Facturer » crée un BROUILLON par `facturer_honoraires` seule (LM-Q8) : la confirmation nomme le client,
// les périodes et le montant hors taxes ; le refus du module se dit avant le clic ; un verrou `useRef`, relâché après la
// relecture ; puis un lien vers le brouillon. Les factures (celles de l'onglet), les lettres, les liens, les avoirs repris et
// les dossiers se lisent EN ENTIER ; lus en partie, refusés ou pas encore revenus, la carte le dit et n'offre AUCUN geste.
// Récit : HISTORIQUE.md, « 11/11/2026 — LM7 : « À FACTURER », À L'ÉCRAN ».

interface Props {
  dossierId: string
  lues: FacturesDeLOnglet
  /** La liste des factures de l'onglet se relit (le brouillon y entre). */
  onFacturee: () => void
  /** Ouvre le brouillon créé, par le chemin d'une facture de la liste. */
  ouvrirLeBrouillon: (factureId: string) => void
}

export default function HonorairesAFacturerCard(p: Props) {
  if (!HONORAIRES_FACTURES_PREVUS) return null
  return <Carte {...p} />
}

function Carte({ dossierId, lues, onFacturee, ouvrirLeBrouillon }: Props) {
  const [relecture, setRelecture] = useState(0)
  const designation = useDesignationDuDossier(dossierId, 0)
  const designee = designation?.dossierId === dossierId ? designation : null
  const cabinetId = designee?.etat === 'lue' && designee.dossierActuel === dossierId ? designee.cabinetId : null
  const lu = useHonorairesAFacturer(dossierId, cabinetId, relecture)
  const lecture = lu?.dossierId === dossierId ? lu : null
  // La sélection et le taux, gardés AVEC le dossier : changer de dossier repart à vide.
  const [choix, setChoix] = useState<{ dossierId: string; coches: ReadonlyMap<string, boolean>; taux: number | null }>({ dossierId, coches: new Map(), taux: null })
  const [avis, setAvis] = useState<{ dossierId: string; erreur: string | null; brouillon: { factureId: string; client: string } | null } | null>(null)
  const facturationEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)

  if (designee === null) return null
  if (designee.etat === 'illisible') {
    return (
      <section className="card">
        <h3>À facturer</h3>
        <p className="error-text">On ne sait pas si ce dossier est celui du cabinet ({designee.motif}) : la facturation des honoraires n’est pas offerte.</p>
      </section>
    )
  }
  if (designee.dossierActuel !== dossierId) return null

  const coches = choix.dossierId === dossierId ? choix.coches : new Map<string, boolean>()
  const taux = choix.dossierId === dossierId ? choix.taux : null
  const erreur = avis?.dossierId === dossierId ? avis.erreur : null
  const brouillon = avis?.dossierId === dossierId ? avis.brouillon : null
  // Un forfait échu est coché d'avance ; une tâche ne l'est jamais : la cocher la dit faite.
  const estCoche = (e: ElementPropose) => coches.get(e.cle) ?? e.forme === 'forfait'

  const entete = <h3>À facturer</h3>
  if (lues === null || lecture === null) return <section className="card">{entete}<p className="muted">Chargement…</p></section>
  if (lues.motif !== null || lecture.etat === 'illisible') {
    const motif = lues.motif ?? (lecture.etat === 'illisible' ? lecture.motif : '')
    return (
      <section className="card">
        {entete}
        <p className="error-text">Les lettres de mission, les factures et leurs liens n’ont pas pu être lus en entier ({motif}) : rien n’est offert à facturer.</p>
      </section>
    )
  }

  const aujourdhui = aujourdHuiAParis()
  const factures: FactureDuCabinet[] = lues.factures.map((f) => ({
    id: f.id, type: f.type, statut: f.statut, montant_ttc: f.montant_ttc, facture_origine_id: f.facture_origine_id, numero: f.numero,
  }))
  const { lettres, liens, avoirsRepris } = lecture
  const clients = aFacturerParClient({ lettres, liens, factures, avoirsRepris, dossiers: lecture.dossiers, aujourdhui })

  function cocher(cle: string, valeur: boolean) {
    setChoix((c) => {
      const base = c.dossierId === dossierId ? c : { dossierId, coches: new Map<string, boolean>(), taux: null }
      return { ...base, coches: new Map(base.coches).set(cle, valeur) }
    })
  }

  async function facturer(client: ClientAFacturer, elements: readonly ElementPropose[], tauxChoisi: number) {
    if (facturationEnCours.current) return
    facturationEnCours.current = true
    setEnCours(true)
    try {
      const issue = await facturerLesHonoraires(dossierId, elements, tauxChoisi)
      setAvis({
        dossierId, erreur: issue.ok ? null : issue.message,
        brouillon: issue.ok ? { factureId: issue.factureId, client: client.nomDuClient ?? 'dossier non lu' } : null,
      })
      if (issue.ok) {
        // La sélection repart à vide : ce qui vient d'être facturé ne se propose plus.
        setChoix((c) => ({ ...c, coches: new Map() }))
        onFacturee()
      }
    } finally {
      setRelecture((n) => n + 1)
      facturationEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <section className="card">
      {entete}
      <p className="muted">
        Les honoraires des lettres de mission acceptées : chaque période de forfait échue, et les tâches par exercice — facturer
        une tâche la dit faite. « Facturer » crée un brouillon de facture pour un client ; il se valide ensuite comme toute facture.
        Une facture créditée en entier par un avoir rend sa période à facturer ; un avoir partiel la laisse facturée.
      </p>
      {erreur && <p className="error-text">{erreur}</p>}
      {brouillon && (
        <p className="success-text">
          Brouillon de facture créé pour « {brouillon.client} ».{' '}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => ouvrirLeBrouillon(brouillon.factureId)}>Ouvrir le brouillon</button>
        </p>
      )}
      <div className="field-row">
        <div className="field">
          <label htmlFor={`taux-honoraires-${dossierId}`}>Taux de TVA des honoraires</label>
          <select id={`taux-honoraires-${dossierId}`} value={taux === null ? '' : String(taux)}
            onChange={(e) => {
              const valeur = e.target.value === '' ? null : Number(e.target.value)
              setChoix((c) => ({ ...(c.dossierId === dossierId ? c : { dossierId, coches: new Map<string, boolean>() }), taux: valeur }))
            }}>
            <option value="">— choisir —</option>
            {TAUX_DES_HONORAIRES.map((t) => <option key={t} value={String(t)}>{libelleDuTaux(t)}</option>)}
          </select>
        </div>
      </div>
      {clients.length === 0 ? <p className="muted">Aucune lettre de mission acceptée n’a d’honoraires à facturer à ce jour.</p> : clients.map((client) => {
        const elements = client.lettres.flatMap((l) => l.elements)
        const choisis = elements.filter(estCoche)
        const refus = refusDeLaSelection(choisis, lettres, liens, factures, avoirsRepris, taux, aujourdhui)
        const totalHt = choisis.reduce((s, e) => s + Math.round(e.montant_ht * 100), 0) / 100
        return (
          <div key={client.clientId}>
            <h4>{client.nomDuClient ?? <span className="muted">dossier non lu</span>}</h4>
            {client.lettres.map(({ lettre, elements: proposes, facturees }) => (
              <div key={lettre.id}>
                <p className="muted">Lettre acceptée le {formatDate(lettre.acceptee_le)}, en effet au {formatDate(lettre.date_effet)}</p>
                {proposes.length === 0 ? <p className="muted">Rien à facturer à ce jour sous cette lettre.</p> : (
                  <ul>
                    {proposes.map((e) => (
                      <li key={e.cle}>
                        <label>
                          <input type="checkbox" checked={estCoche(e)} disabled={enCours} onChange={(ev) => cocher(e.cle, ev.target.checked)} />{' '}
                          {e.designation} — {formatMoney(e.montant_ht)} HT{e.forme === 'tache' ? ' (tâche : à cocher une fois faite)' : ''}
                        </label>
                        {e.rendueParLAvoirDe !== null && (
                          <div className="muted">Redevenue à facturer : la facture {e.rendueParLAvoirDe} a été créditée en entier par un avoir.</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {facturees.length > 0 && (
                  <details>
                    <summary>Déjà facturé ({facturees.length})</summary>
                    <ul>
                      {facturees.map((f) => <li key={f.cle}>{f.designation} — {motsDeLaFacturee(f)}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            ))}
            {elements.length > 0 && (
              <div className="field-row aligne-bas">
                <button type="button" className="btn btn-primary btn-sm" disabled={enCours || refus !== null || taux === null}
                  onClick={() => {
                    if (taux === null || refus !== null) return
                    if (window.confirm(confirmationDeLaFacturation(client.nomDuClient, choisis, taux))) void facturer(client, choisis, taux)
                  }}>
                  Facturer{choisis.length > 0 ? ` (${formatMoney(totalHt)} HT)` : ''}
                </button>
                {refus !== null && <span className="muted">{refus}</span>}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
