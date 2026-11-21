import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { aujourdHuiAParis } from '../lib/format'
import { duContrePaye, TRANCHES_DU_RESTE } from '../lib/duContrePaye'
import {
  DU_CONTRE_PAYE_PREVU, EN_FACE_DIT, LIBELLES_DES_TRANCHES, RAISONS_NON_COMPARABLES, RELECTURE_DU_CLIENT,
  avisDuCompte, fenetreDuClientDite, fenetreProposee, montantDuDu, motsDuDu, organismeDuDuDit, phraseSansCompte, phraseSansLecture,
} from '../lib/duContrePayeVue'
import type { EspaceVentes } from '../lib/espaceVentes'
import { FACTURES_ASSURANCE_MALADIE_PREVUES } from '../lib/importDuFactureAssuranceMaladie'
import { PAIEMENTS_ASSURANCE_MALADIE_PREVUS } from '../lib/paiementsAssuranceMaladie'
import { lireLeFactureAssuranceMaladie, type FactureLu } from '../lib/factureAssuranceMaladieLecture'
import { lireLesPaiementsAssuranceMaladie, type PaiementsLus } from '../lib/paiementsAssuranceMaladieLecture'
import { importsDeLaLecture, sectionAssuranceMaladie, type ImportsDeLaSection } from '../lib/sectionAssuranceMaladie'

// CE QUE L'ASSURANCE MALADIE DOIT, À L'ÉCRAN (conception 59, lots BOR5 et DU-Q3 ; le calcul : lib/duContrePaye.ts, les mots :
// lib/duContrePayeVue.ts). Une section des deux espaces, en LECTURE SEULE : aucune écriture. Elle ne se monte que sous
// `DU_CONTRE_PAYE_PREVU` levé (baissé : DU-Q1) et sous les drapeaux des deux tables ; l'écran qui la monte la garde sous le module
// « assurance_maladie » du cabinet. Elle lit les deux côtés elle-même, en entier (`lireTout` dans les deux lectures), avec le
// dossier lu ; une lecture partielle ou en échec se dit, et rien ne se confronte.
//
// Côté cabinet (l'onglet Banque), la fenêtre se choisit et « Relire » reprend les deux lectures après un import dans les sections
// voisines. Côté client (« Ma banque », sous « Banque », DU-Q3 (A) : « avec les mots du client, sans geste ») : AUCUN bouton ni
// champ — la fenêtre est la période commune, dite ; la case « Banque » se relit à la base avec les deux tables (les deux
// lectures, `espace` client) ; et la section suit la règle d'offre de ses deux voisines (lib/sectionAssuranceMaladie.ts : un code
// NAF de santé, ou un import lu d'un côté ou de l'autre) — hors d'elle, rien ne se dit au client.

type Proprietes =
  | { espace: Extract<EspaceVentes, 'cabinet'>; dossierId: string }
  | {
    espace: Extract<EspaceVentes, 'client'>; dossierId: string
    /** `dossiers.code_naf` tel que l'écran l'a lu : `undefined` tant qu'il ne l'est pas, `null` quand le dossier n'en a pas. */
    codeNaf: string | null | undefined
  }

export default function DuContrePaye(p: Proprietes) {
  if (!DU_CONTRE_PAYE_PREVU || !FACTURES_ASSURANCE_MALADIE_PREVUES || !PAIEMENTS_ASSURANCE_MALADIE_PREVUS) return null
  return p.espace === 'client'
    ? <SectionDuDu key={`${p.dossierId}|client`} espace="client" dossierId={p.dossierId} codeNaf={p.codeNaf} />
    : <SectionDuDu key={`${p.dossierId}|cabinet`} espace="cabinet" dossierId={p.dossierId} codeNaf={null} />
}

interface Lus { facture: FactureLu; paye: PaiementsLus }

/** Ce que les deux lectures disent ensemble des imports : une ligne d'un côté en prouve un ; « aucun » des deux côtés lus en entier. */
function importsDesDeux(lus: Lus | null, dossierId: string): ImportsDeLaSection {
  if (lus === null) return 'inconnu'
  const deux = [importsDeLaLecture(lus.facture, dossierId), importsDeLaLecture(lus.paye, dossierId)]
  if (deux.includes('au-moins-un')) return 'au-moins-un'
  return deux.every((i) => i === 'aucun') ? 'aucun' : 'inconnu'
}

function SectionDuDu({ espace, dossierId, codeNaf }: { espace: EspaceVentes; dossierId: string; codeNaf: string | null | undefined }) {
  const client = espace === 'client'
  const mots = motsDuDu(espace)
  const [lus, setLus] = useState<Lus | null>(null)
  const [fenetre, setFenetre] = useState<{ du: string; au: string } | null>(null)
  const derniere = useRef(0)
  const relire = useCallback(async () => {
    const jeton = ++derniere.current
    const [facture, paye] = await Promise.all([lireLeFactureAssuranceMaladie(dossierId, espace), lireLesPaiementsAssuranceMaladie(dossierId, espace)])
    if (jeton === derniere.current) setLus({ facture, paye })
  }, [dossierId, espace])
  useEffect(() => {
    const jetons = derniere
    void relire()
    return () => { jetons.current++ }
  }, [relire])

  // La règle d'offre des deux sections voisines, au client seul : le cabinet voit la section sous le module, comme hier.
  if (client && !sectionAssuranceMaladie(codeNaf, importsDesDeux(lus, dossierId)).offerte) return null

  const aujourdHui = aujourdHuiAParis()
  let corps: ReactNode
  if (lus === null) {
    corps = <p className="muted">Chargement…</p>
  } else if (lus.facture.etat !== 'lus' || lus.paye.etat !== 'lus') {
    corps = <p className="muted" role="alert">{phraseSansLecture(espace, [lus.facture, lus.paye])}</p>
  } else {
    const proposee = fenetreProposee(lus.facture.imports.lignes, lus.paye.imports.lignes, aujourdHui)
    // Le client ne choisit rien : la période commune seule.
    const choisie = client ? proposee : fenetre ?? proposee
    // Sans période commune, la fenêtre d'un jour : le module dit lequel des deux côtés ne la couvre pas, et leurs étendues.
    const r = duContrePaye({
      facture: { imports: lus.facture.imports, totaux: lus.facture.totaux }, paye: { imports: lus.paye.imports, paiements: lus.paye.paiements },
      fenetre: choisie ?? { du: aujourdHui, au: aujourdHui }, aujourdHui,
    })
    corps = (
      <>
        {client && choisie !== null && <p className="muted">{fenetreDuClientDite(choisie)}</p>}
        {!client && choisie !== null && (
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
    <section className="card" aria-label={mots.titre} style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>{mots.titre}</h3>
      <p className="muted">{mots.presentation}</p>
      <p className="muted">{mots.reserve}</p>
      {corps}
      {client ? <p className="muted" style={{ marginTop: 8 }}>{RELECTURE_DU_CLIENT}</p> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void relire()}>Relire</button>
        </div>
      )}
    </section>
  )
}
