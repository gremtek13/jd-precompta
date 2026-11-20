import { useEffect, useRef, useState, type CSSProperties } from 'react'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'
import { CE_QU_OUVRE_LE_MODULE } from '../lib/modulesDuCabinet'
import { lireLesOptionsDuParc, reglerOptionDuCabinet, type CabinetDuParc, type OptionsDuParcLues } from '../lib/optionsDesCabinetsLecture'
import {
  CABINET_NEUF,
  casesDuCabinet,
  dossiersQuiRetiennent,
  motsDeLaConfirmation,
  phraseDeLaDependance,
  type CaseDUnModule,
} from '../lib/optionsDuCabinetVue'

// LES MODULES DE CHAQUE CABINET, À L'ÉCRAN DU SUPER-ADMINISTRATEUR (conception 56, § 2.5, lot OPT4). Monté par
// SuperAdminPage le drapeau `OPTIONS_DES_CABINETS_PREVUES` levé seulement : avant la migration d'OPT1, rien ne lit la table.
// Par cabinet, les huit modules en cases, lus EN ENTIER (lib/optionsDesCabinetsLecture.ts) ; un cabinet neuf (aucune ligne)
// n'a que le socle, et l'écran le dit. Ce que la base refuserait se dit avant le clic, aux mots de la base
// (lib/optionsDuCabinetVue.ts, qui applique ceux de lib/modulesDuCabinet.ts) : la case ne s'offre pas. Un clic ouvre une
// confirmation qui nomme le cabinet, le module et ce qui s'ouvre ou disparaît des écrans ; « Confirmer » passe
// `regler_option_du_cabinet` seule, sous un verrou `useRef` relâché après la relecture. Une lecture partielle, refusée ou
// rompue se dit, et l'écran n'offre aucun geste ; un cabinet aux options illisibles non plus.

type Demande = { readonly cabinet: CabinetDuParc; readonly case: CaseDUnModule }

export default function OptionsDesCabinets({ relecture }: { relecture: number }) {
  // La lecture se garde avec la clé de relecture qui l'a lancée : tant que celle de la clé courante n'est pas revenue,
  // « Chargement… », aucune case.
  const [lecture, setLecture] = useState<{ readonly cle: number; readonly lu: OptionsDuParcLues } | null>(null)
  const lu = lecture !== null && lecture.cle === relecture ? lecture.lu : null
  const [demande, setDemande] = useState<Demande | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  // Verrou du réglage : `setEnCours(true)` ne prend effet qu'au rendu suivant, deux clics du même rendu appelleraient deux
  // fois la fonction (la seconde fermerait, par exemple, ce que la première vient d'ouvrir à la place d'un autre écran).
  const reglageEnCours = useRef(false)
  // Le numéro de la dernière lecture lancée : une réponse plus lente qu'une lecture partie après elle ne s'écrit pas.
  const derniereLecture = useRef(0)

  async function relire() {
    const numero = ++derniereLecture.current
    const resultat = await lireLesOptionsDuParc()
    if (numero === derniereLecture.current) setLecture({ cle: relecture, lu: resultat })
  }

  useEffect(() => {
    // Une lecture à la clé de relecture seulement (la création ou la suppression d'un cabinet) ; démontée, la réponse se perd.
    let annule = false
    const numero = ++derniereLecture.current
    void lireLesOptionsDuParc().then((resultat) => {
      if (!annule && numero === derniereLecture.current) setLecture({ cle: relecture, lu: resultat })
    })
    return () => { annule = true }
  }, [relecture])

  async function confirmer() {
    if (reglageEnCours.current || demande === null) return
    reglageEnCours.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const refus = await reglerOptionDuCabinet(demande.cabinet.id, demande.case.module, demande.case.geste === 'ouvrir')
      // Refusé ou non, l'écran relit ce que la base tient ; la fenêtre reste ouverte sur un refus, qu'elle dit.
      await relire()
      if (refus !== null) {
        setErreur(refus)
        return
      }
      setDemande(null)
    } finally {
      reglageEnCours.current = false
      setEnCours(false)
    }
  }

  const mots = demande ? motsDeLaConfirmation(demande.cabinet.nom, demande.case) : null

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Modules des cabinets</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Le socle — les dossiers, les pièces, la banque, la caisse, les écritures du brouillon et leur FEC — est toujours ouvert.
          Les huit modules s’ouvrent ou se ferment cabinet par cabinet ; une option ne change ni qui lit quelles données ni les
          chiffres, et fermer un module laisse ses données en place.
        </p>
        {lu === null ? (
          <p className="muted">Chargement…</p>
        ) : lu.etat === 'partielle' ? (
          <BandeauLecturePartielle
            quoi="Les cabinets, leurs options et ce qui retient une fermeture"
            accord="lus"
            motif={lu.motif}
            consequence="Aucun module ne s’ouvre ni ne se ferme d’ici tant que tout n’est pas lu : recharge la page."
          />
        ) : lu.cabinets.length === 0 ? (
          <div className="empty-state">Aucun cabinet.</div>
        ) : (
          lu.cabinets.map((cabinet) => {
            const options = lu.options.get(cabinet.id)
            return (
              <fieldset key={cabinet.id} style={styleCabinet}>
                <legend style={{ fontWeight: 600 }}>{cabinet.nom}</legend>
                {options === undefined || options.etat === 'illisibles' ? (
                  <p className="error-text">
                    Les options de ce cabinet ne sont pas lisibles ({options?.motif ?? 'aucune lecture'}) : aucun module ne s’ouvre
                    ni ne se ferme d’ici.
                  </p>
                ) : (
                  <>
                    {options.neuf && <p className="muted">{CABINET_NEUF}</p>}
                    <div style={styleCases}>
                      {casesDuCabinet(options.ouverts, (m) => dossiersQuiRetiennent(m, cabinet.id, lu.dossiers, lu.dossiersEnEnvoi, lu.dossiersAssocies))
                        .map((c) => {
                          const idCase = `module-${cabinet.id}-${c.module}`
                          const dependance = phraseDeLaDependance(c)
                          const sous = [dependance, c.refus].filter((p): p is string => p !== null)
                          return (
                            <div key={c.module} style={styleCase}>
                              <label htmlFor={idCase} title={CE_QU_OUVRE_LE_MODULE[c.module]} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <input
                                  id={idCase}
                                  type="checkbox"
                                  checked={c.ouverte}
                                  disabled={c.refus !== null || demande !== null || enCours}
                                  aria-describedby={sous.length > 0 ? `${idCase}-note` : undefined}
                                  onChange={() => { setErreur(null); setDemande({ cabinet, case: c }) }}
                                />
                                {c.libelle}
                              </label>
                              {sous.length > 0 && (
                                <span id={`${idCase}-note`} className="muted" style={{ fontSize: '0.78rem' }}>{sous.join(' ')}</span>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  </>
                )}
              </fieldset>
            )
          })
        )}
      </div>

      {demande && mots && (
        <div style={styleFond}>
          <div className="card" role="dialog" aria-modal="true" aria-labelledby="options-confirmation-titre" style={{ width: 'min(480px, 92vw)' }}>
            <h2 id="options-confirmation-titre" style={{ marginTop: 0 }}>{mots.titre}</h2>
            {mots.phrases.map((p) => <p key={p} className="muted">{p}</p>)}
            {erreur && <p className="error-text">{erreur}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn btn-outline" disabled={enCours} onClick={() => { setDemande(null); setErreur(null) }}>
                Annuler
              </button>
              <button
                type="button"
                className={demande.case.geste === 'fermer' ? 'btn btn-danger' : 'btn btn-primary'}
                disabled={enCours}
                onClick={() => { void confirmer() }}
              >
                {enCours ? 'Enregistrement…' : mots.bouton}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const styleCabinet: CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', margin: '0 0 12px', minWidth: 0,
}
const styleCases: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }
const styleCase: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 320 }
const styleFond: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
