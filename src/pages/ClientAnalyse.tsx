import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  ANALYSE_INTRODUCTION, DROITS_ILLISIBLES, MUET_ETAT, MUET_VENTES, RIEN_D_OUVERT, SOURCE_CHIFFRE_D_AFFAIRES, SOURCE_CREANCES,
  SOURCE_ETATS, SOURCE_PAR_ARTICLE, anneesDesVentes, chiffreDAffairesFacture, creancesClients, csvDeLEtat, csvParMois,
  motsDuSolde, nomFichierDeLEtat, parArticle, parClient, parMois, variation, type Comparaison, type Creance, type EtatDeSynthese,
} from '../lib/analyseClient'
import { useAnalyseDuClient, type BanqueDeLAnalyse, type VentesDeLAnalyse } from '../lib/analyseClientLecture'
import { maBanqueOuverte, soldeAuReleve } from '../lib/banqueClient'
import { COUVERTURE_EXPORTEE } from '../lib/couvertureReleve'
import { droitsSur } from '../lib/droitsAcces'
import { VENTES_DU_CLIENT_EXPORTEES } from '../lib/encaissementsFactures'
import { mesVentesOuvertes } from '../lib/espaceVentes'
import { telechargerTexte } from '../lib/fec'
import { aujourdHuiAParis, formatDate, formatMoney } from '../lib/format'

// « MON ANALYSE » (espace client, étape B9a) : les indicateurs et les états de synthèse de ce que les cases « Ventes » et
// « Banque » de la société affichée ouvrent — et rien d'autre : l'analyse n'a pas de case à elle. La règle et les mots dans
// lib/analyseClient.ts, la lecture dans lib/analyseClientLecture.ts (les cases relues à la base d'abord). Rien ne s'écrit.
//
// Le vide est une affirmation : rien ne se dit avant le retour des lectures (« Chargement… ») ; un indicateur dont la liste
// n'est pas lue en entier est MUET, avec son motif en infobulle, jamais « 0 ». « Aujourd'hui » est le jour de Paris, lu au
// rendu.
export default function ClientAnalyse() {
  const { dossierActifId, droitsParDossier } = useAuth()
  // `?? {}` : une doublure de contexte sans droits n'en accorde aucun (seul `true` accorde, lib/droitsAcces.ts).
  const cases = droitsSur(droitsParDossier ?? {}, dossierActifId)
  const lecture = useAnalyseDuClient(
    dossierActifId,
    mesVentesOuvertes(VENTES_DU_CLIENT_EXPORTEES, cases.ventes),
    maBanqueOuverte(COUVERTURE_EXPORTEE, cases.banque),
  )

  if (!dossierActifId) {
    return <p className="muted">Aucun dossier ne t'est encore rattaché — contacte ton cabinet comptable.</p>
  }

  return (
    <>
      <div className="topbar"><h1>Mon analyse</h1></div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>{ANALYSE_INTRODUCTION}</p>

      {lecture === null ? (
        <div className="card"><p className="muted" aria-busy="true">Chargement…</p></div>
      ) : lecture.etat === 'droits_illisibles' ? (
        <div className="card"><p className="error-text" title={lecture.motif}>{DROITS_ILLISIBLES}</p></div>
      ) : lecture.ventes.etat === 'fermee' && lecture.banque.etat === 'fermee' ? (
        <div className="card"><p className="muted">{RIEN_D_OUVERT}</p></div>
      ) : (
        <>
          <Indicateurs ventes={lecture.ventes} banque={lecture.banque} />
          {lecture.ventes.etat !== 'fermee' && <Etats ventes={lecture.ventes} />}
        </>
      )}
    </>
  )
}

// ── Les indicateurs ──────────────────────────────────────────────────────────────────────────────────────────────────
function Indicateurs({ ventes, banque }: { ventes: VentesDeLAnalyse; banque: BanqueDeLAnalyse }) {
  const aujourdHui = aujourdHuiAParis()
  const motifVentes = ventes.etat === 'illisible' ? ventes.motif : null
  const ca = ventes.etat === 'lue' ? chiffreDAffairesFacture(ventes.listes, aujourdHui) : null
  const creances = ventes.etat === 'lue' ? creancesClients(ventes.listes, aujourdHui) : null
  const solde = banque.etat === 'lue' ? soldeAuReleve(banque.controles) : null

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Tes indicateurs</h2>
      {ventes.etat !== 'fermee' && (
        <section aria-label="Chiffre d’affaires facturé">
          <h3>Chiffre d’affaires facturé, hors taxes</h3>
          {ca === null || ca.etat === 'muet' ? (
            <p className="error-text" title={ca?.etat === 'muet' ? ca.motif : motifVentes ?? undefined}>{MUET_VENTES}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, lineHeight: 1.7 }}>
              <LigneComparee c={ca.mois} />
              <LigneComparee c={ca.cumul} />
            </ul>
          )}
          <p className="muted" style={{ fontSize: '0.85rem' }}>{SOURCE_CHIFFRE_D_AFFAIRES}</p>
        </section>
      )}
      {ventes.etat !== 'fermee' && (
        <section aria-label="Ce que tes clients te doivent">
          <h3>Ce que tes clients te doivent</h3>
          {creances === null || creances.etat === 'muet' ? (
            <p className="error-text" title={creances?.etat === 'muet' ? creances.motif : motifVentes ?? undefined}>{MUET_VENTES}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, lineHeight: 1.7 }}>
              <LigneCreance libelle="En retard" c={creances.enRetard} />
              <LigneCreance libelle="À venir" c={creances.aVenir} />
              <LigneCreance libelle="Sans échéance" c={creances.sansEcheance} />
              <LigneCreance libelle="Total" c={creances.total} fort />
            </ul>
          )}
          <p className="muted" style={{ fontSize: '0.85rem' }}>{SOURCE_CREANCES}</p>
        </section>
      )}
      {solde !== null && (
        <section aria-label="Ta trésorerie">
          <h3>Ta trésorerie</h3>
          {solde.etat === 'lu' && (
            <p style={{ margin: '0 0 4px' }}>
              Solde au relevé du {formatDate(solde.au)} : <strong style={{ whiteSpace: 'nowrap' }}>{formatMoney(solde.solde)}</strong>
            </p>
          )}
          <p
            className={solde.etat === 'muet' ? 'error-text' : 'muted'} style={{ fontSize: solde.etat === 'lu' ? '0.85rem' : undefined }}
            title={solde.etat === 'muet' ? solde.motif : undefined}
          >
            {motsDuSolde(solde)}
          </p>
        </section>
      )}
    </div>
  )
}

function LigneComparee({ c }: { c: Comparaison }) {
  const v = variation(c)
  return (
    <li>
      {c.libelle.charAt(0).toUpperCase() + c.libelle.slice(1)} : <strong style={{ whiteSpace: 'nowrap' }}>{formatMoney(c.centimes / 100)}</strong>
      {' '}<span className="muted">({c.libelleN1} : <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(c.n1Centimes / 100)}</span>{v ? `, ${v}` : ''})</span>
    </li>
  )
}

function LigneCreance({ libelle, c, fort = false }: { libelle: string; c: Creance; fort?: boolean }) {
  const montant = <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(c.centimes / 100)}</span>
  return (
    <li>
      {libelle} : {fort ? <strong>{montant}</strong> : montant}
      {' '}<span className="muted">({c.nombre} facture{c.nombre > 1 ? 's' : ''})</span>
    </li>
  )
}

// ── Les états de synthèse ────────────────────────────────────────────────────────────────────────────────────────────
function Etats({ ventes }: { ventes: Exclude<VentesDeLAnalyse, { etat: 'fermee' }> }) {
  const aujourdHui = aujourdHuiAParis()
  const [choisie, setChoisie] = useState<number | null>(null)
  if (ventes.etat === 'illisible') {
    return <div className="card"><h2 style={{ marginTop: 0 }}>Tes ventes en détail</h2><p className="error-text" title={ventes.motif}>{MUET_ETAT}</p></div>
  }
  const annees = anneesDesVentes(ventes.listes.facturesIncompletes == null ? ventes.listes.factures : [], aujourdHui)
  const annee = choisie !== null && annees.includes(choisie) ? choisie : annees[0]
  const clients = parClient(ventes.listes, annee)
  const articles = parArticle(ventes.listes, ventes.provenance, annee)
  const mois = parMois(ventes.listes, annee)

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Tes ventes en détail</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>{SOURCE_ETATS}</p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="analyse-annee">Année</label>
          <select id="analyse-annee" value={annee} onChange={(e) => setChoisie(Number(e.target.value))}>
            {annees.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      <EtatEnTableau
        titre="Par client" colonne="Client" etat={clients}
        exporter={clients.etat === 'lu' ? () => telechargerTexte(nomFichierDeLEtat('client', annee), csvDeLEtat('client', annee, clients)) : null}
      />
      <EtatEnTableau
        titre="Par article" colonne="Article" etat={articles} note={SOURCE_PAR_ARTICLE}
        exporter={articles.etat === 'lu' ? () => telechargerTexte(nomFichierDeLEtat('article', annee), csvDeLEtat('article', annee, articles)) : null}
      />

      <section aria-label="Par mois">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <h3>Par mois</h3>
          {mois.etat === 'lu' && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => telechargerTexte(nomFichierDeLEtat('mois', annee), csvParMois(annee, mois))}>
              Exporter (CSV)
            </button>
          )}
        </div>
        {mois.etat === 'muet' ? (
          <p className="error-text" title={mois.motif}>{MUET_ETAT}</p>
        ) : (
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable-etroite" aria-label="Chiffre d’affaires par mois">
              <thead><tr><th>Mois</th><th>{annee}</th><th>{annee - 1}</th></tr></thead>
              <tbody>
                {mois.lignes.map((l) => (
                  <tr key={l.mois}>
                    <td data-libelle="Mois">{l.libelle}</td>
                    <td data-libelle={String(annee)}>{formatMoney(l.centimes / 100)}</td>
                    <td data-libelle={String(annee - 1)}>{formatMoney(l.n1Centimes / 100)}</td>
                  </tr>
                ))}
                <tr>
                  <td data-libelle="Mois"><strong>Total</strong></td>
                  <td data-libelle={String(annee)}><strong>{formatMoney(mois.centimes / 100)}</strong></td>
                  <td data-libelle={String(annee - 1)}><strong>{formatMoney(mois.n1Centimes / 100)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function EtatEnTableau({ titre, colonne, etat, note, exporter }: {
  titre: string; colonne: string; etat: EtatDeSynthese; note?: string; exporter: (() => void) | null
}) {
  return (
    <section aria-label={titre}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h3>{titre}</h3>
        {exporter && etat.etat === 'lu' && etat.lignes.length > 0 && (
          <button type="button" className="btn btn-outline btn-sm" onClick={exporter}>Exporter (CSV)</button>
        )}
      </div>
      {note && <p className="muted" style={{ fontSize: '0.85rem' }}>{note}</p>}
      {etat.etat === 'muet' ? (
        <p className="error-text" title={etat.motif}>{MUET_ETAT}</p>
      ) : etat.lignes.length === 0 ? (
        <p className="muted">Pas de facture validée cette année.</p>
      ) : (
        <div className="table-scroll tableau-adaptable">
          <table className="table-empilable-etroite" aria-label={`Chiffre d’affaires ${titre.toLowerCase()}`}>
            <thead><tr><th>{colonne}</th><th>Documents</th><th>Hors taxes</th></tr></thead>
            <tbody>
              {etat.lignes.map((l) => (
                <tr key={l.cle}>
                  <td data-libelle={colonne}>{l.libelle}{l.detail && <span className="muted"> ({l.detail})</span>}</td>
                  <td data-libelle="Documents">{l.documents}</td>
                  <td data-libelle="Hors taxes">{formatMoney(l.centimes / 100)}</td>
                </tr>
              ))}
              <tr>
                <td data-libelle={colonne}><strong>Total</strong></td>
                <td data-libelle="Documents"></td>
                <td data-libelle="Hors taxes"><strong>{formatMoney(etat.centimes / 100)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
