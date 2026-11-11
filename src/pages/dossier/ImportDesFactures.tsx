import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { formatMoney } from '../../lib/format'
import { ouvrirApercu } from '../../lib/apercu'
import { ORIGINAUX_DES_IMPORTS_PREVUS } from '../../lib/bornesStockage'
import { NATURES, TRANSMISSIONS, TYPES_CLIENT, type TransmiseePar } from '../../lib/lectureDesFacturesReprises'
import {
  CSV_A_VENIR, ENCAISSE_AU_PRORATA, IMPORT_DES_FACTURES_OFFERT, LIBELLES_FORMAT, LIBELLES_NATURE, LIBELLES_TRANSMISSION,
  LIBELLES_TYPE_CLIENT, ORIGINAUX_PAS_ENCORE_GARDES, avisDuDecoupage, bilanDesImports, choixVides, confirmationDeLaDateDeReprise,
  confirmationDesImports, confirmationDuRetrait, fichiersDUnImport, jjmmaaaa, jugerLeLot, premierDuMois, refusDeLaDateDeReprise,
  refusDuDossier, titreDUnImport, type ChoixSaisis, type FichierLu, type IssueDUnImport, type LectureDeLImport, type LotLu,
} from '../../lib/importDesFacturesVue'
import {
  fixerLaDateDeReprise, importerLeLot, lireLEtatDeLImport, lireLesFichiers, retirerLImport, type IssueDUnGeste,
} from '../../lib/importDesFacturesLecture'
import type { NatureOperation, TypeClient } from '../../lib/types'

// LES FACTURES DE L'ANCIEN LOGICIEL (ligne 51.5, étape A8d2b), sous la liste des factures du dossier, CÔTÉ CABINET seul,
// derrière `IMPORT_DES_FACTURES_OFFERT` : baissé, rien n'est lu ni rendu (l'onglet d'hier). La règle et les mots vivent dans
// lib/importDesFacturesVue.ts, la lecture et les gestes dans lib/importDesFacturesLecture.ts. Une lecture illisible n'offre
// aucun geste ; chaque geste passe par sa fonction de la base, sous un verrou `useRef` relâché après la relecture ; les
// refus se disent avant le clic, fichier par fichier ; la confirmation nomme ce qui part. Des fichiers de formats différents
// déposés ensemble partent en un import par format (A8D2B-Q2) : le découpage se dit avant le clic, la confirmation nomme chaque
// import, et le bilan dit lequel est passé, lequel a été refusé, lequel n'est pas parti.

interface Props {
  dossierId: string
  /** Après un import ou un retrait : la liste des factures de l'onglet se relit. */
  onChange: () => void
}

type Avis = { dossierId: string; erreur: string | null; fait: string | null }

export default function ImportDesFactures({ dossierId, onChange }: Props) {
  const { estChef } = useAuth()
  const [lu, setLu] = useState<LectureDeLImport | null>(null)
  const [ouvert, setOuvert] = useState(false)
  const [fichiers, setFichiers] = useState<{ dossierId: string; liste: FichierLu[] } | null>(null)
  const [lectureDesFichiers, setLectureDesFichiers] = useState(false)
  const [choix, setChoix] = useState<Record<string, ChoixSaisis>>({})
  const [pourTous, setPourTous] = useState<{ type_client: TypeClient | null; transmise_par: TransmiseePar | null }>({ type_client: null, transmise_par: null })
  const [mois, setMois] = useState('')
  const [avis, setAvis] = useState<Avis | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Les verrous d'exécution, un par geste : `enCours` ne prend effet qu'au rendu suivant.
  const importEnCours = useRef(false)
  const retraitEnCours = useRef(false)
  const repriseEnCours = useRef(false)
  const dossierAffiche = useRef(dossierId)
  const depots = useRef(0)

  useEffect(() => {
    if (!IMPORT_DES_FACTURES_OFFERT) return
    dossierAffiche.current = dossierId
    let annule = false
    lireLEtatDeLImport(dossierId).then((l) => { if (!annule) setLu(l) })
    return () => { annule = true }
  }, [dossierId])

  if (!IMPORT_DES_FACTURES_OFFERT) return null

  const lecture = lu && (lu.etat === 'lue' ? lu.lue.dossierId : lu.dossierId) === dossierId ? lu : null
  const etat = lecture?.etat === 'lue' ? lecture.lue : null
  const liste = fichiers?.dossierId === dossierId ? fichiers.liste : []
  const jugement = etat ? jugerLeLot(etat, liste, choix, ORIGINAUX_DES_IMPORTS_PREVUS) : null
  const avisAffiche = avis?.dossierId === dossierId ? avis : null

  const relire = async (dossierEcrit: string) => {
    const l = await lireLEtatDeLImport(dossierEcrit)
    if (dossierAffiche.current === dossierEcrit) setLu(l)
  }

  const finir = async (dossierEcrit: string, issue: IssueDUnGeste, apres?: () => void) => {
    await relire(dossierEcrit)
    if (dossierAffiche.current !== dossierEcrit) return
    setAvis({ dossierId: dossierEcrit, erreur: issue.ok ? null : issue.erreur, fait: issue.ok ? issue.message : null })
    if (issue.ok) { apres?.(); onChange() }
  }

  const deposer = async (choisis: FileList | null) => {
    if (!etat || !choisis || choisis.length === 0) return
    const dossierLu = dossierId
    const n = ++depots.current
    setLectureDesFichiers(true)
    const lus = await lireLesFichiers([...choisis], etat.siren, ORIGINAUX_DES_IMPORTS_PREVUS, `d${n}`)
    if (depots.current !== n || dossierAffiche.current !== dossierLu) return
    setLectureDesFichiers(false)
    setFichiers({ dossierId: dossierLu, liste: lus })
    setChoix(Object.fromEntries(lus.map((f) => [f.cle, choixVides()])))
  }

  const changer = (cle: string, modif: Partial<ChoixSaisis>) => {
    setChoix((c) => ({ ...c, [cle]: { ...(c[cle] ?? choixVides()), ...modif } }))
  }

  const appliquerATous = () => {
    setChoix((c) => Object.fromEntries(liste.map((f) => {
      const avant = c[f.cle] ?? choixVides()
      return [f.cle, {
        ...avant,
        ...(pourTous.type_client ? { type_client: pourTous.type_client } : {}),
        ...(pourTous.transmise_par && pourTous.transmise_par !== 'plateforme' ? { transmise_par: pourTous.transmise_par } : {}),
      }]
    })))
  }

  // Les imports partent l'un après l'autre, chacun par `importerLeLot` (tout ou rien, ses originaux déposés avant lui et
  // retirés s'il est refusé) ; le premier refus arrête la suite — un import qui suit peut citer une facture de celui qui a
  // échoué, et le cabinet décide de nouveau sur ce qui reste. Ce qui est passé quitte les fichiers déposés ; le reste y
  // demeure, avec ses choix.
  const importer = async () => {
    const imports = jugement?.imports
    if (!imports || importEnCours.current) return
    if (!window.confirm(confirmationDesImports(imports, ORIGINAUX_DES_IMPORTS_PREVUS))) return
    importEnCours.current = true
    setEnCours(true)
    const dossierEcrit = dossierId
    try {
      const issues: IssueDUnImport[] = []
      for (const pret of imports) {
        if (issues.some((i) => i.etat !== 'repris')) { issues.push({ etat: 'pas_parti' }); continue }
        const issue = await importerLeLot(dossierEcrit, pret, liste, ORIGINAUX_DES_IMPORTS_PREVUS)
        issues.push(issue.ok ? { etat: 'repris', message: issue.message } : { etat: 'refuse', erreur: issue.erreur })
      }
      const reprises = new Set(imports.flatMap((p, i) => (issues[i].etat === 'repris' ? p.factures.map((f) => f.cle) : [])))
      await relire(dossierEcrit)
      if (dossierAffiche.current !== dossierEcrit) return
      const bilan = bilanDesImports(imports, issues)
      setAvis({ dossierId: dossierEcrit, erreur: bilan.erreur, fait: bilan.fait })
      if (reprises.size > 0) {
        setFichiers((f) => (f && f.dossierId === dossierEcrit ? { ...f, liste: f.liste.filter((x) => !reprises.has(x.cle)) } : f))
        setChoix((c) => Object.fromEntries(Object.entries(c).filter(([cle]) => !reprises.has(cle))))
        onChange()
      }
    } finally {
      importEnCours.current = false
      setEnCours(false)
    }
  }

  const retirer = async (lot: LotLu) => {
    if (retraitEnCours.current) return
    if (!window.confirm(confirmationDuRetrait(lot, ORIGINAUX_DES_IMPORTS_PREVUS, estChef))) return
    retraitEnCours.current = true
    setEnCours(true)
    const dossierEcrit = dossierId
    try {
      await finir(dossierEcrit, await retirerLImport(dossierEcrit, lot, ORIGINAUX_DES_IMPORTS_PREVUS, estChef))
    } finally {
      retraitEnCours.current = false
      setEnCours(false)
    }
  }

  const poserLaDate = async () => {
    if (!etat || repriseEnCours.current || refusDeLaDateDeReprise(etat, mois, estChef) !== null) return
    if (!window.confirm(confirmationDeLaDateDeReprise(mois))) return
    repriseEnCours.current = true
    setEnCours(true)
    const dossierEcrit = dossierId
    try {
      await finir(dossierEcrit, await fixerLaDateDeReprise(dossierEcrit, premierDuMois(mois) as string), () => setMois(''))
    } finally {
      repriseEnCours.current = false
      setEnCours(false)
    }
  }

  const voir = async (chemin: string) => {
    const r = await ouvrirApercu('ventes', chemin, 60)
    if (!r.ok) setAvis({ dossierId, erreur: r.message, fait: null })
  }

  const refusDate = etat ? refusDeLaDateDeReprise(etat, mois, estChef) : null
  const refusDossier = etat ? refusDuDossier(etat) : null

  return (
    <section className="card" aria-labelledby="titre-import-factures" style={{ marginTop: 18 }}>
      <h3 id="titre-import-factures" style={{ marginTop: 0 }}>Factures de l’ancien logiciel</h3>
      {lecture === null && <p className="muted">Chargement…</p>}
      {lecture?.etat === 'illisible' && (
        <p className="error-text">L’état de l’import n’a pas pu être lu ({lecture.motif}) : rien ne s’importe ni ne se retire d’ici.</p>
      )}
      {etat && (
        <>
          <p>
            Date de reprise des factures :{' '}
            {etat.repriseLe ? <strong>le {jjmmaaaa(etat.repriseLe)}</strong> : <span className="muted">pas encore posée</span>}
            {etat.lots.length > 0 && <span className="muted"> — figée depuis le premier import</span>}
          </p>
          {estChef && etat.lots.length === 0 && etat.bascule && (
            <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 8 }}>
              <label>
                Premier mois repris par l’application
                <input type="month" value={mois} onChange={(e) => setMois(e.target.value)} aria-describedby="aide-date-reprise" />
              </label>
              <button type="button" className="btn btn-outline btn-sm" disabled={enCours || mois === '' || refusDate !== null} onClick={poserLaDate}>
                Poser la date de reprise
              </button>
              {mois !== '' && refusDate && <p id="aide-date-reprise" className="muted" style={{ flexBasis: '100%', margin: 0 }}>{refusDate}</p>}
            </div>
          )}
          {refusDossier ? (
            <p className="muted">{refusDossier}</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
              <button type="button" className="btn btn-outline btn-sm" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)}>
                {ouvert ? 'Fermer la reprise' : 'Reprendre des factures de l’ancien logiciel'}
              </button>
            </div>
          )}

          {!refusDossier && ouvert && jugement && (
            <div className="import-factures">
              <p className="muted">
                Factur-X (PDF), CII ou UBL : un fichier par facture, un format par import — des formats mêlés partent en
                plusieurs imports. {CSV_A_VENIR}{' '}
                {!ORIGINAUX_DES_IMPORTS_PREVUS && ORIGINAUX_PAS_ENCORE_GARDES}
              </p>
              <label>
                Fichiers des factures
                <input type="file" multiple accept=".pdf,.xml,application/pdf,text/xml,application/xml" disabled={enCours}
                  onChange={(e) => { void deposer(e.target.files); e.target.value = '' }} />
              </label>
              {lectureDesFichiers && <p className="muted">Lecture des fichiers…</p>}

              {liste.length > 0 && (
                <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  <label>
                    Type du client, pour toutes
                    <select value={pourTous.type_client ?? ''} onChange={(e) => setPourTous((p) => ({ ...p, type_client: (e.target.value || null) as TypeClient | null }))}>
                      <option value="">— à choisir —</option>
                      {TYPES_CLIENT.map((t) => <option key={t} value={t}>{LIBELLES_TYPE_CLIENT[t]}</option>)}
                    </select>
                  </label>
                  <label>
                    Transmission, pour toutes
                    <select value={pourTous.transmise_par ?? ''} onChange={(e) => setPourTous((p) => ({ ...p, transmise_par: (e.target.value || null) as TransmiseePar | null }))}>
                      <option value="">— à choisir —</option>
                      {TRANSMISSIONS.filter((t) => t !== 'plateforme').map((t) => <option key={t} value={t}>{LIBELLES_TRANSMISSION[t]}</option>)}
                    </select>
                  </label>
                  <button type="button" className="btn btn-outline btn-sm" disabled={!pourTous.type_client && !pourTous.transmise_par} onClick={appliquerATous}>
                    Appliquer à toutes les factures
                  </button>
                </div>
              )}

              {jugement.fichiers.map((f) => {
                const c = choix[f.cle] ?? choixVides()
                const a = f.apercu
                return (
                  <article key={f.cle} className="card" style={{ marginTop: 10 }} aria-label={`Fichier ${f.nom}`}>
                    <p style={{ margin: 0 }}><span className="nom-fichier">{f.nom}</span></p>
                    {a && (
                      <div className="table-scroll">
                        <table>
                          <tbody>
                            <tr><th scope="row">{a.type === 'avoir' ? 'Avoir' : 'Facture'}</th><td>{a.numero} — {LIBELLES_FORMAT[a.format]}</td></tr>
                            <tr><th scope="row">Date</th><td>{jjmmaaaa(a.date_emission)}</td></tr>
                            <tr><th scope="row">Client</th><td>{a.client}</td></tr>
                            <tr><th scope="row">HT</th><td>{formatMoney(a.ht_centimes / 100)}</td></tr>
                            {a.par_taux.map((t) => (
                              <tr key={t.taux}><th scope="row">TVA {t.taux.toLocaleString('fr-FR')} %</th><td>{formatMoney(t.tva_centimes / 100)} sur {formatMoney(t.ht_centimes / 100)} HT</td></tr>
                            ))}
                            <tr><th scope="row">TTC</th><td>{formatMoney(a.ttc_centimes / 100)}</td></tr>
                            <tr><th scope="row">Nature</th><td>{a.nature ? LIBELLES_NATURE[a.nature] : 'à choisir'}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                    {f.lue && (
                      <div className="field-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <label>
                          Type du client
                          <select value={c.type_client ?? ''} onChange={(e) => changer(f.cle, { type_client: (e.target.value || null) as TypeClient | null })}>
                            <option value="">— à choisir —</option>
                            {TYPES_CLIENT.map((t) => <option key={t} value={t}>{LIBELLES_TYPE_CLIENT[t]}</option>)}
                          </select>
                        </label>
                        <label>
                          Transmission
                          <select value={c.transmise_par ?? ''} onChange={(e) => changer(f.cle, { transmise_par: (e.target.value || null) as TransmiseePar | null })}>
                            <option value="">— à choisir —</option>
                            {TRANSMISSIONS.map((t) => <option key={t} value={t}>{LIBELLES_TRANSMISSION[t]}</option>)}
                          </select>
                        </label>
                        {c.transmise_par === 'plateforme' && (
                          <label>
                            Plateforme agréée
                            <input type="text" value={c.plateforme_nom} maxLength={100} onChange={(e) => changer(f.cle, { plateforme_nom: e.target.value })} />
                          </label>
                        )}
                        {f.lue.type === 'facture' && (
                          <label>
                            Encaissé avant la reprise (€)
                            <input type="text" inputMode="decimal" value={c.encaisse} onChange={(e) => changer(f.cle, { encaisse: e.target.value })} />
                          </label>
                        )}
                        {f.lue.nature_lue === null && (
                          <label>
                            Nature des opérations
                            <select value={c.nature_operation ?? ''} onChange={(e) => {
                              const n = (e.target.value || null) as NatureOperation | null
                              changer(f.cle, { nature_operation: n, natures_des_lignes: n === 'mixte' ? (f.lue as NonNullable<typeof f.lue>).lignes.map(() => null) : [] })
                            }}>
                              <option value="">— à choisir —</option>
                              {NATURES.map((n) => <option key={n} value={n}>{LIBELLES_NATURE[n]}</option>)}
                            </select>
                          </label>
                        )}
                        {f.lue.option_debits_lue === null && (
                          <label>
                            Option pour les débits
                            <select value={c.option_debits === null ? '' : c.option_debits ? 'oui' : 'non'}
                              onChange={(e) => changer(f.cle, { option_debits: e.target.value === '' ? null : e.target.value === 'oui' })}>
                              <option value="">— à choisir —</option>
                              <option value="oui">Oui</option>
                              <option value="non">Non</option>
                            </select>
                          </label>
                        )}
                        {(f.lue.nature_lue ?? c.nature_operation) === 'mixte' && f.lue.lignes.map((l, i) => (
                          <label key={i}>
                            Ligne {i + 1} : {l.designation.slice(0, 40)}
                            <select value={c.natures_des_lignes[i] ?? ''} onChange={(e) => {
                              const natures = f.lue ? f.lue.lignes.map((_, j) => (j === i ? (e.target.value || null) as 'biens' | 'services' | null : c.natures_des_lignes[j] ?? null)) : []
                              changer(f.cle, { natures_des_lignes: natures })
                            }}>
                              <option value="">— à choisir —</option>
                              <option value="biens">Biens</option>
                              <option value="services">Services</option>
                            </select>
                          </label>
                        ))}
                      </div>
                    )}
                    {f.refus.length > 0 && (
                      <ul className="error-text" aria-label={`Ce qui retient ${f.nom}`}>
                        {f.refus.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    )}
                  </article>
                )
              })}

              {liste.length > 0 && (
                <>
                  <p className="muted">{ENCAISSE_AU_PRORATA}</p>
                  {avisDuDecoupage(jugement.decoupage) && (
                    <div className="note-info" role="note" aria-label="Le découpage en imports">
                      <p style={{ marginTop: 0 }}>{avisDuDecoupage(jugement.decoupage)}</p>
                      <ol style={{ marginBottom: 0 }}>
                        {jugement.decoupage.map((d, i) => (
                          <li key={d.format}>
                            {titreDUnImport(i + 1, jugement.decoupage.length, d.format)} — <span className="nom-fichier">{fichiersDUnImport(d)}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {jugement.refusDuLot.map((r, i) => <p key={i} className="error-text">{r}</p>)}
                  {!jugement.imports && jugement.refusDuLot.length === 0 && (
                    <p className="muted">
                      {jugement.decoupage.length > 1
                        ? 'Un fichier retenu retient tous les imports : rien ne part tant qu’un fichier est retenu.'
                        : 'Un fichier retenu retient tout l’import : la base reprend tout ou rien.'}
                    </p>
                  )}
                  <button type="button" className="btn btn-primary btn-sm" disabled={enCours || !jugement.imports} onClick={importer}>
                    {enCours
                      ? 'Import…'
                      : `Importer ${liste.length} document${liste.length > 1 ? 's' : ''}`
                        + (jugement.decoupage.length > 1 ? ` en ${jugement.decoupage.length} imports` : '')}
                  </button>
                </>
              )}
            </div>
          )}

          {etat.lots.length > 0 && (
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Importé le</th><th>Format</th><th>Documents</th><th /></tr></thead>
                <tbody>
                  {etat.lots.map((lot) => (
                    <tr key={lot.id}>
                      <td>{jjmmaaaa(lot.importe_le.slice(0, 10))}</td>
                      <td>{lot.format in LIBELLES_FORMAT ? LIBELLES_FORMAT[lot.format as keyof typeof LIBELLES_FORMAT] : lot.format.toUpperCase()}</td>
                      <td>
                        {lot.factures.map((f) => (
                          <span key={f.facture_id} style={{ marginRight: 8 }}>
                            {f.numero}
                            {ORIGINAUX_DES_IMPORTS_PREVUS && f.fichier_chemin && (
                              <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 4 }} onClick={() => void voir(f.fichier_chemin as string)}>
                                Voir l’original
                              </button>
                            )}
                          </span>
                        ))}
                      </td>
                      <td>
                        <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => void retirer(lot)}>
                          Retirer l’import
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {avisAffiche?.erreur && <p className="error-text" role="alert">{avisAffiche.erreur}</p>}
      {avisAffiche?.fait && <p className="muted" role="status">{avisAffiche.fait}</p>}
    </section>
  )
}
