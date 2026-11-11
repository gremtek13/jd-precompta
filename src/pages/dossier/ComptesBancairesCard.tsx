import { useEffect, useRef, useState } from 'react'
import { COMPTES_BANCAIRES_PREVUS, dateDite } from '../../lib/comptesBancaires'
import {
  ceQuiResteModifiable, changements, compteDuPlanDit, comptesDesRolesDuPlan, confirmationDeLaCreation, confirmationDeLaModification,
  jugerLaCreation, jugerLaModification, saisieDuCompte, saisieNeuve, usageDe, type SaisieDeLaFiche,
} from '../../lib/ficheDesComptesBancaires'
import { corrigerLeCompte, creerLeCompte, lireLaFiche, type Issue, type LectureDeLaFiche } from '../../lib/ficheDesComptesBancairesLecture'
import { LIBELLE_NOM_COMPTE_BANCAIRE } from '../../lib/droitsAcces'
import type { PlanComptable } from '../../lib/planComptable'

// LA CARTE « COMPTES BANCAIRES » DE L'ONGLET INFORMATIONS (ligne 26.6, lot MCB6 ; HISTORIQUE.md, « 11/11/2026 — LES ÉCRANS DU
// CABINET POUR PLUSIEURS COMPTES BANCAIRES (MCB6) »), derrière `COMPTES_BANCAIRES_PREVUS` (la migration `comptes_bancaires`,
// préparée) : baissé, elle ne rend rien et ne lit rien. Informations plutôt que Banque : un compte est un réglage du dossier,
// comme la source des ventes ou la numérotation, et l'import, dans Banque, le choisit seulement.
// Elle dit chaque compte — son nom, que le client « Banque » lit (MCB-Q8), le compte du plan où s'écrit sa banque et depuis
// quand (MCB-Q1, MCB-Q7), son ouverture et sa clôture, la fin de son identifiant (MCB2), ce que la base porte sous lui et ce
// qu'elle permet encore d'en changer — et offre de créer un compte et d'en corriger un. Ce qu'elle juge vient de
// lib/ficheDesComptesBancaires.ts (les refus de l'application, puis ceux de la base, dits avant le clic sur la saisie telle
// qu'elle part), ce qu'elle lit et écrit de lib/ficheDesComptesBancairesLecture.ts (qui ne rejette jamais) ; lue en partie,
// refusée ou rompue, elle le dit et n'offre AUCUN geste ; rien ne s'affirme avant le retour de la lecture. Chaque confirmation
// nomme ce qui change et ce qui se figera ; chaque geste passe sous un verrou relâché après la relecture.

export default function ComptesBancairesCard({ dossierId, plan }: { dossierId: string; plan: PlanComptable }) {
  if (!COMPTES_BANCAIRES_PREVUS) return null
  return <CarteDesComptes dossierId={dossierId} plan={plan} />
}

type Edition = { mode: 'creation' } | { mode: 'correction'; id: string }

function CarteDesComptes({ dossierId, plan }: { dossierId: string; plan: PlanComptable }) {
  const [lu, setLu] = useState<LectureDeLaFiche | null>(null)
  const [edition, setEdition] = useState<Edition | null>(null)
  const [saisie, setSaisie] = useState<SaisieDeLaFiche | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Ce que le dernier geste a dit, avec le dossier écrit : ailleurs, la carte n'en dit rien.
  const [avis, setAvis] = useState<{ dossierId: string; erreur: string | null; fait: string | null } | null>(null)
  // Le verrou d'exécution, en `useRef` : `enCours` ne prend effet qu'au rendu suivant, et deux clics du même rendu écriraient deux fois.
  const gesteEnCours = useRef(false)
  // Le dossier affiché : une relecture qui revient pour un autre ne remplace pas la sienne.
  const affiche = useRef(dossierId)

  useEffect(() => {
    affiche.current = dossierId
    let annule = false
    void lireLaFiche(dossierId).then((lecture) => { if (!annule) setLu(lecture) })
    return () => { annule = true }
  }, [dossierId])

  const lecture = lu?.dossierId === dossierId ? lu : null
  const comptes = lecture?.etat === 'lue' ? lecture.comptes : null
  const usages = lecture?.etat === 'lue' ? lecture.usages : null
  const erreur = avis?.dossierId === dossierId ? avis.erreur : null
  const fait = avis?.dossierId === dossierId ? avis.fait : null
  const roles = comptesDesRolesDuPlan(plan)
  const editeDansCeDossier = edition !== null && saisie !== null && comptes !== null && usages !== null
  const avant = editeDansCeDossier && edition.mode === 'correction' ? comptes.find((c) => c.id === edition.id) ?? null : null
  const usageAvant = avant && usages ? usageDe(usages, avant.id) : null
  const jugement = !editeDansCeDossier ? null
    : edition.mode === 'creation' ? jugerLaCreation(saisie, comptes, roles)
      : avant && usageAvant ? jugerLaModification(avant, saisie, comptes, roles, usageAvant) : null
  const rienNeChange = jugement?.ligne != null && avant !== null && changements(avant, jugement.ligne).length === 0
  const principalAEcrire = edition?.mode === 'creation' ? comptes?.length === 0 : avant?.principal === true
  const fige = avant !== null && usageAvant !== null && !avant.principal && (usageAvant.mouvements > 0 || usageAvant.releves > 0)

  function ouvrir(e: Edition) {
    if (comptes === null) return
    const compte = e.mode === 'correction' ? comptes.find((c) => c.id === e.id) : undefined
    if (e.mode === 'correction' && compte === undefined) return
    setEdition(e)
    setSaisie(compte ? saisieDuCompte(compte) : saisieNeuve(comptes, roles))
    setAvis(null)
  }

  function fermer() {
    setEdition(null)
    setSaisie(null)
  }

  async function enregistrer() {
    // Posé avant le `try` : dedans, le `return` du deuxième clic sortirait par le `finally` et relâcherait le verrou du premier.
    if (gesteEnCours.current || !jugement || jugement.ligne === null || edition === null || rienNeChange) return
    const corrige = edition.mode === 'correction' && avant !== null && usageAvant !== null ? { avant, usage: usageAvant } : null
    if (edition.mode === 'correction' && corrige === null) return
    gesteEnCours.current = true
    const dossierEcrit = dossierId
    const ligne = jugement.ligne
    try {
      const confirmation = corrige === null ? confirmationDeLaCreation(ligne, plan.banque)
        : confirmationDeLaModification(corrige.avant, ligne, corrige.usage)
      if (!window.confirm(confirmation)) return
      setEnCours(true)
      setAvis(null)
      const issue: Issue = edition.mode === 'creation' ? await creerLeCompte(dossierEcrit, ligne) : await corrigerLeCompte(dossierEcrit, edition.id, ligne)
      if (issue.ok) {
        setAvis({ dossierId: dossierEcrit, erreur: null, fait: edition.mode === 'creation' ? `Le compte « ${ligne.libelle} » est créé ✓` : `Le compte « ${ligne.libelle} » est corrigé ✓` })
        fermer()
      } else {
        setAvis({ dossierId: dossierEcrit, erreur: `Rien n’a changé : ${issue.message}`, fait: null })
      }
      // Relue, quoi qu'il arrive : les comptes tels que la base les tient maintenant.
      const relue = await lireLaFiche(dossierEcrit)
      if (affiche.current === dossierEcrit) setLu(relue)
    } finally {
      gesteEnCours.current = false
      setEnCours(false)
    }
  }

  const champ = (cle: keyof SaisieDeLaFiche) => (valeur: string) => setSaisie((s) => (s === null ? s : { ...s, [cle]: valeur }))

  return (
    <div className="card" style={{ maxWidth: 640, marginBottom: 20 }} data-testid="comptes-bancaires">
      <h3 style={{ marginTop: 0 }}>Comptes bancaires</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Les comptes bancaires professionnels du dossier : chaque relevé s’importe sous le sien, dans l’onglet Banque. Le compte
        principal suit le compte de banque du plan ({plan.banque}) ; un autre compte tient son propre compte 512, depuis le
        1er janvier 2026 au plus tôt — l’exercice 2025 se valide avec le seul compte de banque du principal.
      </p>
      {lecture === null && <p className="muted">Chargement…</p>}
      {lecture?.etat === 'illisible' && (
        <p className="error-text" role="alert">
          Les comptes bancaires n’ont pas pu être lus en entier — {lecture.motif}. Aucun geste n’est offert tant qu’ils ne le sont pas.
        </p>
      )}
      {comptes !== null && usages !== null && (
        <>
          {comptes.length === 0 && (
            <p className="muted">
              Le dossier ne tient encore aucun compte : le premier relevé importé crée le compte principal. Le créer ici permet de
              lui donner son nom et sa date d’ouverture d’abord.
            </p>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {comptes.map((c) => {
              const u = usageDe(usages, c.id)
              return (
                <li key={c.id} style={{ marginBottom: 12 }} data-testid={`compte-bancaire-${c.id}`}>
                  <strong>{c.libelle}</strong>{c.principal && <span className="muted"> — compte principal</span>}
                  <div className="muted">
                    Sa banque s’écrit {compteDuPlanDit(c, plan.banque)}.
                    {c.ouvert_le !== null && ` Ouvert le ${dateDite(c.ouvert_le)}.`}
                    {c.clos_le !== null && ` Clos le ${dateDite(c.clos_le)}.`}
                    {c.fin_d_identifiant !== null && ` Identifiant •••• ${c.fin_d_identifiant}.`}
                    {` ${u.mouvements} mouvement${u.mouvements > 1 ? 's' : ''}, ${u.releves} relevé${u.releves > 1 ? 's' : ''} contrôlé${u.releves > 1 ? 's' : ''}.`}
                  </div>
                  <div className="muted">{ceQuiResteModifiable(c, u)}</div>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={enCours || edition !== null}
                    onClick={() => ouvrir({ mode: 'correction', id: c.id })}>
                    Corriger « {c.libelle} »
                  </button>
                </li>
              )
            })}
          </ul>
          {erreur && <p className="error-text">{erreur}</p>}
          {fait && <p className="muted">{fait}</p>}
          {edition === null && (
            <button type="button" className="btn btn-primary btn-sm" disabled={enCours} onClick={() => ouvrir({ mode: 'creation' })}>
              {comptes.length === 0 ? 'Créer le compte principal' : 'Ajouter un compte bancaire'}
            </button>
          )}
          {edition !== null && saisie !== null && (
            <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
              <legend>
                <strong>{edition.mode === 'creation' ? (principalAEcrire ? 'Le compte principal' : 'Un compte bancaire de plus') : `Corriger « ${avant?.libelle ?? ''} »`}</strong>
              </legend>
              <div className="field">
                <label htmlFor="compte-bancaire-libelle">{LIBELLE_NOM_COMPTE_BANCAIRE}</label>
                <input id="compte-bancaire-libelle" value={saisie.libelle} maxLength={80} disabled={enCours} onChange={(e) => champ('libelle')(e.target.value)} />
              </div>
              {!principalAEcrire && (
                <div className="field-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <div className="field">
                    <label htmlFor="compte-bancaire-compte">Son compte du plan (512 et trois chiffres)</label>
                    <input id="compte-bancaire-compte" value={saisie.compte} inputMode="numeric" style={{ maxWidth: 140 }} disabled={enCours || fige}
                      onChange={(e) => champ('compte')(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="compte-bancaire-depuis">Qu’il tient depuis le 1er janvier de</label>
                    <input id="compte-bancaire-depuis" value={saisie.depuis} inputMode="numeric" style={{ maxWidth: 110 }} disabled={enCours || fige}
                      onChange={(e) => champ('depuis')(e.target.value)} />
                  </div>
                </div>
              )}
              <div className="field-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="field">
                  <label htmlFor="compte-bancaire-ouvert">Ouvert le</label>
                  <input id="compte-bancaire-ouvert" type="date" value={saisie.ouvertLe} disabled={enCours} onChange={(e) => champ('ouvertLe')(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="compte-bancaire-clos">Clos le (facultatif)</label>
                  <input id="compte-bancaire-clos" type="date" value={saisie.closLe} disabled={enCours} onChange={(e) => champ('closLe')(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="compte-bancaire-fin">Fin de l’identifiant (facultative)</label>
                  <input id="compte-bancaire-fin" value={saisie.finDIdentifiant} maxLength={4} style={{ maxWidth: 90 }} disabled={enCours}
                    onChange={(e) => champ('finDIdentifiant')(e.target.value)} />
                </div>
              </div>
              {jugement?.refus != null && <p className="muted" role="status">{jugement.refus}</p>}
              {rienNeChange && <p className="muted" role="status">Rien n’est changé.</p>}
              <div className="field-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={enCours || jugement === null || jugement.refus !== null || rienNeChange}
                  onClick={() => { void enregistrer() }}>
                  {enCours ? 'Enregistrement…' : edition.mode === 'creation' ? 'Créer le compte' : 'Enregistrer la correction'}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={enCours} onClick={fermer}>Annuler</button>
              </div>
            </fieldset>
          )}
        </>
      )}
    </div>
  )
}
