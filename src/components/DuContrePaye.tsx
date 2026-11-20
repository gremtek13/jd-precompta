import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { aujourdHuiAParis } from '../lib/format'
import { duContrePaye, TRANCHES_DU_RESTE } from '../lib/duContrePaye'
import {
  DU_CONTRE_PAYE_PREVU, EN_FACE_DIT, LIBELLES_DES_TRANCHES, PRESENTATION_DU_DU, RAISONS_NON_COMPARABLES, RESERVE_DES_CAISSES,
  TITRE_DU_DU, avisDuCompte, fenetreProposee, montantDuDu, organismeDuDuDit, phraseSansCompte,
} from '../lib/duContrePayeVue'
import { FACTURES_ASSURANCE_MALADIE_PREVUES } from '../lib/importDuFactureAssuranceMaladie'
import { PAIEMENTS_ASSURANCE_MALADIE_PREVUS } from '../lib/paiementsAssuranceMaladie'
import { lireLeFactureAssuranceMaladie, type FactureLu } from '../lib/factureAssuranceMaladieLecture'
import { lireLesPaiementsAssuranceMaladie, type PaiementsLus } from '../lib/paiementsAssuranceMaladieLecture'

// CE QUE L'ASSURANCE MALADIE DOIT, À L'ÉCRAN (conception 59, lot BOR5 ; le calcul : lib/duContrePaye.ts, les mots :
// lib/duContrePayeVue.ts). Une section de l'onglet Banque du CABINET, en LECTURE SEULE : aucun geste, aucune écriture. Elle ne se
// monte que sous `DU_CONTRE_PAYE_PREVU` levé (baissé : DU-Q1) et sous les drapeaux des deux tables ; l'onglet la garde sous le
// module « assurance_maladie » du cabinet. Elle lit les deux côtés elle-même, en entier (`lireTout` dans les deux lectures), avec
// le dossier lu ; une lecture partielle ou en échec se dit, et rien ne se confronte. « Relire » reprend les deux lectures après
// un import dans les sections voisines.

export default function DuContrePaye({ dossierId }: { dossierId: string }) {
  if (!DU_CONTRE_PAYE_PREVU || !FACTURES_ASSURANCE_MALADIE_PREVUES || !PAIEMENTS_ASSURANCE_MALADIE_PREVUS) return null
  return <SectionDuDu key={dossierId} dossierId={dossierId} />
}

interface Lus { facture: FactureLu; paye: PaiementsLus }

function SectionDuDu({ dossierId }: { dossierId: string }) {
  const [lus, setLus] = useState<Lus | null>(null)
  const [fenetre, setFenetre] = useState<{ du: string; au: string } | null>(null)
  const derniere = useRef(0)
  const relire = useCallback(async () => {
    const jeton = ++derniere.current
    const [facture, paye] = await Promise.all([lireLeFactureAssuranceMaladie(dossierId, 'cabinet'), lireLesPaiementsAssuranceMaladie(dossierId, 'cabinet')])
    if (jeton === derniere.current) setLus({ facture, paye })
  }, [dossierId])
  useEffect(() => {
    const jetons = derniere
    void relire()
    return () => { jetons.current++ }
  }, [relire])

  const aujourdHui = aujourdHuiAParis()
  let corps: ReactNode
  if (lus === null) {
    corps = <p className="muted">Chargement…</p>
  } else if (lus.facture.etat !== 'lus' || lus.paye.etat !== 'lus') {
    const motif = [lus.facture, lus.paye].map((l) => (l.etat === 'echec' ? l.motif : null)).filter((m) => m !== null).join(' ; ')
    corps = <p className="muted" role="alert">Rien n’est confronté : {motif || 'la lecture n’a pas abouti'}.</p>
  } else {
    const proposee = fenetreProposee(lus.facture.imports.lignes, lus.paye.imports.lignes, aujourdHui)
    const choisie = fenetre ?? proposee
    // Sans période commune, la fenêtre d'un jour : le module dit lequel des deux côtés ne la couvre pas, et leurs étendues.
    const r = duContrePaye({
      facture: { imports: lus.facture.imports, totaux: lus.facture.totaux }, paye: { imports: lus.paye.imports, paiements: lus.paye.paiements },
      fenetre: choisie ?? { du: aujourdHui, au: aujourdHui }, aujourdHui,
    })
    corps = (
      <>
        {choisie !== null && (
          <div className="field-row aligne-bas" style={{ flexWrap: 'wrap' }}>
            <label className="field">Lots créés du
              <input type="date" value={choisie.du} max={aujourdHui} onChange={(e) => setFenetre({ du: e.target.value, au: choisie.au })} />
            </label>
            <label className="field">au
              <input type="date" value={choisie.au} max={aujourdHui} onChange={(e) => setFenetre({ du: choisie.du, au: e.target.value })} />
            </label>
            {fenetre !== null && proposee !== null && (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setFenetre(null)}>Toute la période commune</button>
            )}
          </div>
        )}
        {r.etat !== 'compte' ? <p className="muted" role="status">{phraseSansCompte(r)}</p> : (
          <>
            <ul className="muted" style={{ marginTop: 8 }}>{avisDuCompte(r).map((a) => <li key={a}>{a}</li>)}</ul>
            <div className="tableau-adaptable">
              <table className="table-empilable-etroite" aria-label="Ce que l’assurance maladie doit, par organisme">
                <thead>
                  <tr>
                    <th>Part obligatoire</th><th>Facturé</th><th>Payé (journées de la fenêtre)</th><th>Reste estimé</th>
                    {TRANCHES_DU_RESTE.map((t) => <th key={t}>{LIBELLES_DES_TRANCHES[t]}</th>)}<th>Payé sans lot en face</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lignes.map((l) => (
                    <tr key={`${l.regime}|${l.caisse}`}>
                      <td data-libelle="Part obligatoire">
                        {organismeDuDuDit(l)}{EN_FACE_DIT[l.enFace] && <div className="muted">{EN_FACE_DIT[l.enFace]}</div>}
                      </td>
                      <td data-libelle="Facturé">{montantDuDu(l.factureCentimes)}</td>
                      <td data-libelle="Payé (journées de la fenêtre)">{montantDuDu(l.payeDesJourneesCentimes)}</td>
                      <td data-libelle="Reste estimé">{montantDuDu(l.resteEstimeCentimes)}</td>
                      {TRANCHES_DU_RESTE.map((t) => <td key={t} data-libelle={LIBELLES_DES_TRANCHES[t]}>{montantDuDu(l.tranches[t])}</td>)}
                      <td data-libelle="Payé sans lot en face">{montantDuDu(l.payeSansLotEnFaceCentimes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.lignes.length === 0 && <p className="muted">Aucun montant de la part obligatoire sur cette fenêtre.</p>}
            {r.nonComparables.length > 0 && (
              <>
                <h4 style={{ marginBottom: 6 }}>Non comparable</h4>
                <ul>
                  {r.nonComparables.map((l) => (
                    <li key={`${l.part}|${l.raison}|${l.regime}|${l.caisse}`}>
                      {organismeDuDuDit(l)} — {l.factureCentimes === null ? '' : `facturé ${montantDuDu(l.factureCentimes)}, `}
                      payé {montantDuDu(l.payeDesJourneesCentimes)} : {RAISONS_NON_COMPARABLES[l.raison]}.
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </>
    )
  }

  return (
    <section className="card" aria-label={TITRE_DU_DU} style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>{TITRE_DU_DU}</h3>
      <p className="muted">{PRESENTATION_DU_DU}</p>
      <p className="muted">{RESERVE_DES_CAISSES}</p>
      {corps}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void relire()}>Relire</button>
      </div>
    </section>
  )
}
