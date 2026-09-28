import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { arrondirPourFormulaire } from '../../lib/cases2035'
import { formaterMontant } from '../../lib/gabarit2035'
import {
  AUXILIAIRES_MEDICAUX, LIBELLES_PROFESSION, estimerCotisationsUrssaf, natureAbattement, ratioConventionne,
  recettesBrutesRetenues,
} from '../../lib/voletSocialPamc'
import type { ProfessionPamc, VoletSocialPamc } from '../../lib/types'
import { messageErreur } from '../../lib/messageErreur'

// Le volet social d'un praticien ou auxiliaire médical conventionné, sous le report du revenu brut
// social (ligne 27 de la feuille de route, décision du cabinet du 28/09/2026) : les rubriques propres
// à ces professions, et l'estimation des cotisations que l'Urssaf appellera sur ces revenus.
//
// AFFICHÉ SUR TOUS LES DOSSIERS À PARTIR DE 2025, et l'intitulé dit à qui il s'adresse : c'est le
// choix du cabinet, plutôt qu'une case « conventionné » de plus à tenir dans Informations.
//
// LES CHIFFRES DU SNIR SONT GARDÉS (table `volet_social_pamc`, une ligne par exercice) : ils ne
// viennent pas de la comptabilité, et les retaper à chaque visite serait la saisie que
// l'application existe pour éviter. D'où la règle déjà payée trois fois ailleurs : une lecture
// ratée ne laisse JAMAIS un formulaire vide qu'« Enregistrer » écrirait par-dessus ce qui existe —
// le formulaire ne s'affiche que sur une lecture réussie.

type Lecture =
  | { etat: 'chargement' }
  | { etat: 'lue'; ligne: VoletSocialPamc | null }
  | { etat: 'erreur'; message: string }

interface Champs {
  profession: ProfessionPamc | ''
  remplacant: boolean
  recettesBrutes: string
  honoraires: string
  depassements: string
  structures: string
}

const PROFESSIONS = Object.keys(LIBELLES_PROFESSION) as ProfessionPamc[]

function champsDe(ligne: VoletSocialPamc | null): Champs {
  const texte = (n: number | null | undefined) => (n == null ? '' : String(n))
  return {
    profession: ligne?.profession ?? '',
    remplacant: ligne?.remplacant ?? false,
    recettesBrutes: texte(ligne?.recettes_brutes),
    honoraires: texte(ligne?.honoraires_conventionnes),
    depassements: texte(ligne?.depassements),
    structures: texte(ligne?.recettes_structures),
  }
}

// Un champ vide vaut « pas saisi » (null), jamais zéro : un zéro se saisit. `input type="number"`
// rend une chaîne vide pour une saisie illisible, donc seul un nombre négatif est à refuser ici.
function montant(texte: string): number | null | 'invalide' {
  if (texte.trim() === '') return null
  const n = Number(texte)
  return Number.isFinite(n) && n >= 0 ? n : 'invalide'
}

const euros = (n: number) => `${formaterMontant(Math.round(n))} €`

const ABATTEMENT: Record<ReturnType<typeof natureAbattement>, string> = {
  taux: "l'abattement de 26 %",
  plancher: "l'abattement minimal, 1,76 % du plafond de la sécurité sociale",
  plafond: "l'abattement maximal, 130 % du plafond de la sécurité sociale",
}

export default function VoletSocialCard({ dossierId, annee, valeurs, blocage }: {
  dossierId: string
  annee: number
  valeurs: Map<string, number>
  // Non nul quand une entrée de la déclaration n'a pas été lue en entier : la proposition des
  // recettes et l'estimation reposeraient sur une 2035 amputée, elles se suspendent.
  blocage: string | null
}) {
  const [lecture, setLecture] = useState<Lecture>({ etat: 'chargement' })
  const [champs, setChamps] = useState<Champs>(champsDe(null))
  const [enregistrement, setEnregistrement] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // Verrou posé avant tout `await`, relâché dans le `finally` : deux « Enregistrer » rapprochés
  // n'écrivent qu'une fois.
  const enregistrementEnCours = useRef(false)

  useEffect(() => {
    let annule = false
    ;(async () => {
      const { data, error } = await supabase
        .from('volet_social_pamc').select('*').eq('dossier_id', dossierId).eq('annee', annee).maybeSingle()
      if (annule) return
      if (error) {
        setLecture({ etat: 'erreur', message: messageErreur(error, 'Lecture impossible.') })
        return
      }
      const ligne = (data as VoletSocialPamc | null) ?? null
      setLecture({ etat: 'lue', ligne })
      setChamps(champsDe(ligne))
    })()
    return () => { annule = true }
  }, [dossierId, annee])

  // Les montants tels que le formulaire les porte, à l'euro — ceux que l'administration préremplit.
  const formulaire = arrondirPourFormulaire(valeurs, annee)
  const recettesNettes = formulaire.get('AD') ?? 0
  const revenuBrutSocial = (formulaire.get('DD') ?? 0) - (formulaire.get('DC') ?? 0)

  const saisis = {
    recettesBrutes: montant(champs.recettesBrutes),
    honoraires: montant(champs.honoraires),
    depassements: montant(champs.depassements),
    structures: montant(champs.structures),
  }
  const invalide = Object.values(saisis).some((v) => v === 'invalide')
  const nombre = (v: number | null | 'invalide') => (v === 'invalide' ? null : v)
  const recettes = recettesBrutesRetenues({ recettes_brutes: nombre(saisis.recettesBrutes) }, recettesNettes)
  const ratio = ratioConventionne(nombre(saisis.honoraires), recettes.montant)
  const estimation = estimerCotisationsUrssaf({
    annee,
    profession: champs.profession === '' ? null : champs.profession,
    remplacant: champs.remplacant,
    revenuBrutSocial,
    revenuProfessionnelPositif: (formulaire.get('CP') ?? 0) > 0,
    recettesBrutes: recettes.montant,
    honorairesConventionnes: nombre(saisis.honoraires),
    depassements: nombre(saisis.depassements),
  })

  const enregistre = lecture.etat === 'lue' ? champsDe(lecture.ligne) : null
  const modifie = enregistre !== null && JSON.stringify(enregistre) !== JSON.stringify(champs)

  async function enregistrer() {
    if (enregistrementEnCours.current || lecture.etat !== 'lue' || invalide) return
    enregistrementEnCours.current = true
    setEnregistrement(true)
    setMessage(null)
    try {
      const { data, error } = await supabase
        .from('volet_social_pamc')
        .upsert({
          dossier_id: dossierId,
          annee,
          profession: champs.profession === '' ? null : champs.profession,
          remplacant: champs.remplacant,
          recettes_brutes: nombre(saisis.recettesBrutes),
          honoraires_conventionnes: nombre(saisis.honoraires),
          depassements: nombre(saisis.depassements),
          recettes_structures: nombre(saisis.structures),
        }, { onConflict: 'dossier_id,annee' })
        .select()
        .single()
      if (error) {
        setMessage(messageErreur(error, 'L’enregistrement n’a pas abouti.'))
        return
      }
      const ligne = data as VoletSocialPamc
      setLecture({ etat: 'lue', ligne })
      setChamps(champsDe(ligne))
      setMessage('Enregistré.')
    } catch (err) {
      setMessage(messageErreur(err, 'L’enregistrement n’a pas abouti.'))
    } finally {
      enregistrementEnCours.current = false
      setEnregistrement(false)
    }
  }

  const changer = (champ: keyof Champs) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const valeur = e.target instanceof HTMLInputElement && e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setChamps((c) => ({ ...c, [champ]: valeur }))
    setMessage(null)
  }

  const medecinOuDentiste = champs.profession !== '' && !['auxiliaire_medical', 'sage_femme'].includes(champs.profession)

  return (
    <div style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--color-border)', fontSize: '0.9rem' }}>
      <strong>Volet social {annee} — praticien ou auxiliaire médical conventionné</strong>
      <p className="muted" style={{ margin: '4px 0 10px' }}>
        Les rubriques propres aux praticiens conventionnés (notice 2041-DRI). Les chiffres du relevé
        SNIR se saisissent ici et restent enregistrés pour cet exercice.
      </p>

      {lecture.etat === 'chargement' && <p className="muted">Chargement…</p>}
      {lecture.etat === 'erreur' && (
        <p className="error-text">
          Les chiffres enregistrés n'ont pas pu être lus ({lecture.message}). La saisie est suspendue
          pour ne pas écraser ce qui existe peut-être : recharger la page.
        </p>
      )}

      {lecture.etat === 'lue' && (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`profession-${annee}`}>Profession</label>
              <select id={`profession-${annee}`} value={champs.profession} onChange={changer('profession')} style={{ maxWidth: '100%' }}>
                <option value="">— à choisir —</option>
                {PROFESSIONS.map((p) => <option key={p} value={p}>{LIBELLES_PROFESSION[p]}</option>)}
              </select>
              <span className="muted" style={{ fontSize: '0.8rem' }}>Auxiliaire médical : {AUXILIAIRES_MEDICAUX}.</span>
            </div>
            <div className="field">
              <label>
                <input type="checkbox" checked={champs.remplacant} onChange={changer('remplacant')} style={{ marginRight: 6 }} />
                Remplaçant exclusif au 1er janvier
              </label>
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`dscs-${annee}`}>Recettes brutes totales (DSCS)</label>
              <input id={`dscs-${annee}`} type="number" step="0.01" min="0" value={champs.recettesBrutes}
                placeholder={blocage ? '' : String(recettesNettes)} onChange={changer('recettesBrutes')} />
            </div>
            <div className="field">
              <label htmlFor={`dsav-${annee}`}>Honoraires conventionnés, SNIR (DSAV)</label>
              <input id={`dsav-${annee}`} type="number" step="0.01" min="0" value={champs.honoraires} onChange={changer('honoraires')} />
            </div>
            <div className="field">
              <label htmlFor={`dsaw-${annee}`}>Dépassements, SNIR (DSAW)</label>
              <input id={`dsaw-${annee}`} type="number" step="0.01" min="0" value={champs.depassements} onChange={changer('depassements')} />
            </div>
            <div className="field">
              <label htmlFor={`dsat-${annee}`}>Recettes en structures de soins (DSAT)</label>
              <input id={`dsat-${annee}`} type="number" step="0.01" min="0" value={champs.structures} onChange={changer('structures')} />
            </div>
          </div>
          <p className="muted" style={{ marginTop: -6 }}>
            Recettes brutes laissées vides : l'application reprend la ligne 4 de la 2035-A (recettes
            nettes des débours et des honoraires rétrocédés) ; la notice ne nomme aucune ligne. Les
            honoraires du SNIR se corrigent des remplacements, des rétrocessions, des sommes CPTS et MSP,
            de l'article 51, du FNPEIS et des protocoles de coopération ; pour un pédicure-podologue, des
            orthèses plantaires, que le relevé de mars 2026 ne compte pas. Structures de soins : EHPAD,
            SSIAD, HAD, CMPP… — prise en charge seulement si le cabinet de ville fait au moins 15 % de
            l'activité.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={enregistrer} disabled={enregistrement || !modifie || invalide}>
              {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {modifie && !enregistrement && <span className="badge badge-neutral">modifications non enregistrées</span>}
            {invalide && <span className="error-text">Un montant ne peut pas être négatif.</span>}
            {message && <span className={message === 'Enregistré.' ? 'muted' : 'error-text'}>{message}</span>}
          </div>

          {blocage ? (
            <p className="error-text" style={{ marginTop: 10 }}>
              Une entrée de la déclaration n'a pas été lue en entier ({blocage}) : les recettes
              proposées et l'estimation des cotisations sont suspendues.
            </p>
          ) : (
            <>
              <div className="table-scroll" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr><th>Rubrique</th><th>Libellé</th><th style={{ textAlign: 'right' }}>À déclarer</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ fontFamily: 'monospace' }}>DSCS</td>
                      <td>
                        Recettes brutes totales
                        <span className="muted" style={{ marginLeft: 8, fontSize: '0.85em' }}>
                          {recettes.proposees ? 'proposées : ligne 4 de la 2035-A' : 'saisies'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euros(recettes.montant)}</td>
                    </tr>
                    <tr>
                      <td style={{ fontFamily: 'monospace' }}>DSAV</td>
                      <td>Recettes tirées d'actes conventionnés</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {nombre(saisis.honoraires) == null ? <span className="muted">à saisir</span> : euros(nombre(saisis.honoraires)!)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontFamily: 'monospace' }}>DSAW</td>
                      <td>Dépassements d'honoraires</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {nombre(saisis.depassements) == null ? <span className="muted">à saisir (0 s'il n'y en a pas)</span> : euros(nombre(saisis.depassements)!)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontFamily: 'monospace' }}>DSAU</td>
                      <td>Ratio conventionné</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {ratio.ratio === null ? <span className="muted">—</span> : ratio.ratio.toFixed(2).replace('.', ',')}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontFamily: 'monospace' }}>DSAT</td>
                      <td>Recettes en structures de soins</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {nombre(saisis.structures) == null ? <span className="muted">—</span> : euros(nombre(saisis.structures)!)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {ratio.motif && <p className="muted" style={{ marginTop: 6 }}>{ratio.motif}</p>}
              <p className="muted" style={{ marginTop: 6 }}>
                Second déclarant : DSDS, DSBV, DSBW, DSBU et DSBT.
                {medecinOuDentiste && ' Médecins adhérents à l’OPTAM (DSAX, DSAY) et chirurgiens-dentistes (taux DSAZ) : à reprendre du relevé complémentaire.'}
                {' '}L'application ne connaît pas les indemnités journalières perçues (DSDX, préremplies),
                les autres revenus de remplacement (DSCZ) ni les chèques-vacances (DSCN) : à vérifier sur
                la déclaration.
              </p>

              <EstimationCotisations annee={annee} revenuBrutSocial={revenuBrutSocial} resultat={estimation} />
            </>
          )}
        </>
      )}
    </div>
  )
}

function EstimationCotisations({ annee, revenuBrutSocial, resultat }: {
  annee: number
  revenuBrutSocial: number
  resultat: ReturnType<typeof estimerCotisationsUrssaf>
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <strong>Cotisations Urssaf estimées sur les revenus {annee}</strong>
      {!resultat.disponible ? (
        <p className="muted" style={{ margin: '6px 0 0' }}>{resultat.motif}</p>
      ) : (
        <>
          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table>
              <tbody>
                <tr>
                  <td>
                    Assiette : revenu brut social {euros(revenuBrutSocial)}, moins
                    {' '}{ABATTEMENT[natureAbattement(resultat.estimation)]} ({euros(resultat.estimation.abattement)})
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euros(resultat.estimation.assiette)}</td>
                </tr>
                <tr>
                  <td>CSG-CRDS, dont {euros(resultat.estimation.csgCrdsDeductible)} déductibles</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {euros(resultat.estimation.csgCrdsDeductible + resultat.estimation.csgCrdsNonDeductible)}
                  </td>
                </tr>
                <tr>
                  <td>
                    Maladie-maternité {euros(resultat.estimation.maladie)}, moins la prise en charge par
                    l'Assurance maladie ({euros(resultat.estimation.priseEnChargeMaladie)})
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {euros(resultat.estimation.maladie - resultat.estimation.priseEnChargeMaladie)}
                  </td>
                </tr>
                <tr>
                  <td>Contribution de 3,25 % (dépassements et activité non conventionnée)</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euros(resultat.estimation.contributionAdditionnelle)}</td>
                </tr>
                <tr>
                  <td>Indemnités journalières</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euros(resultat.estimation.indemnitesJournalieres)}</td>
                </tr>
                <tr>
                  <td>Allocations familiales</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euros(resultat.estimation.allocationsFamiliales)}</td>
                </tr>
                <tr>
                  <td>CURPS (unions régionales des professionnels de santé)</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euros(resultat.estimation.curps)}</td>
                </tr>
                <tr>
                  <td>Formation professionnelle</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euros(resultat.estimation.formationProfessionnelle)}</td>
                </tr>
                <tr style={{ fontWeight: 600 }}>
                  <td>Total à la charge du praticien</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euros(resultat.estimation.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Cotisations définitives estimées comme le fait le simulateur de l'Urssaf, d'après les chiffres
            ci-dessus. Hors retraite (appelée par la caisse, pas par l'Urssaf), hors indemnités
            journalières perçues, ACRE, exonérations et outre-mer ; activité supposée commencée avant
            {' '}{annee}. La régularisation est l'écart avec les cotisations provisionnelles appelées pour
            {' '}{annee} : seul l'avis de l'Urssaf la chiffre.
          </p>
        </>
      )}
    </div>
  )
}
