import { useState } from 'react'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { formatDate } from '../../lib/format'
import type { NatureReprise } from '../../lib/inventaire'
import {
  ecrituresAJour, euros, LIBELLES_DES_NATURES, natureAvecTvaDAttente, refusDuRetraitDeLOperation, type ContexteDeLInventaire,
  type DonneesDeLInventaire,
} from '../../lib/inventaireEcran'
import {
  ceQueLaValidationRetiendra, comptesDeLaBalancePourLaNature, formulaireDeLaRepriseLue, formulaireDeRepriseVide, NATURES_DE_LA_REPRISE,
  ouvertureDeLaBalance, pieceDeLaReprise, racinesDites, repriseOuverteSur, reprisesDeLExercice, soldeDit, verdictDeLaReprise,
  type FormulaireDeLaReprise, type LigneDeLaBalanceReprise, type VerdictDeLaReprise,
} from '../../lib/regularisationRepriseEcran'
import { optionCitee, optionsDeCitation, piecesCitablesParUneRegularisation, type Citation, type JustificatifsDuDossier } from '../../lib/justificatifsDeLInventaire'
import type { OperationInventaire } from '../../lib/types'
import ChoixDuJustificatif from './ChoixDuJustificatif'

// LES RÉGULARISATIONS REPRISES D'UNE BALANCE, DANS L'ONGLET INVENTAIRE (ligne 35, INV3-Q2 (A) ; docs/conceptions/35-inventaire.md,
// § 11). Montée par l'onglet sur le PREMIER exercice du dossier seulement, celui qu'ouvre sa balance reprise. Une balance reprise au
// 1er janvier qui porte d'anciennes charges ou d'anciens produits constatés d'avance, factures non parvenues ou à établir reçoit
// ici, une par régularisation de l'ancien logiciel, une régularisation REPRISE : sa constatation est dans la balance, seule son
// extourne au 1er janvier s'écrit, sous la pièce « Inventaire N−1 ». Le compte se choisit parmi ceux de la balance, sous la racine
// de la nature. La section dit avant le clic ce que la validation retiendra (`reprise-non-extournee`) : chaque compte repris que
// les extournes enregistrées ne soldent pas.
//
// RIEN DE LA LOGIQUE N'EST ICI (lib/regularisationRepriseEcran.ts) et RIEN NE S'ÉCRIT D'ICI : les gestes remontent à l'onglet, qui
// les passe sous SON verrou (`agir`) par `enregistrer_operation_inventaire` et `retirer_operation_inventaire`, puis relit tout.
// La balance se lit EN ENTIER à part (lib/balanceRepriseDeLInventaireLecture.ts) : pas revenue, « Chargement… » ; lue en partie,
// refusée ou rompue, la section le dit et n'offre AUCUN geste, ni ne dit ce que la validation retiendra.

export type LectureDeLaBalance =
  | { etat: 'absente' }
  | { etat: 'incomplete'; motif: string }
  | { etat: 'lue'; lignes: readonly LigneDeLaBalanceReprise[] }

export type RepriseAEnregistrer = Extract<VerdictDeLaReprise, { etat: 'permis' }>

interface Props {
  exercice: number
  ctx: ContexteDeLInventaire
  donnees: DonneesDeLInventaire
  /** La lecture de la balance reprise, gardée avec son dossier par l'onglet (nulle : pas revenue). */
  balance: LectureDeLaBalance | null
  lectureDesJustificatifs: { etat: 'absente' } | { etat: 'incomplete'; motif: string } | { etat: 'lue' } | null
  justificatifs: JustificatifsDuDossier | null
  /** Un geste de l'onglet est en cours : rien ne se clique. */
  enCours: boolean
  /** Le geste d'enregistrement, sous le verrou de l'onglet ; `apres` remet le formulaire quand la base a écrit. */
  onEnregistrer: (verdict: RepriseAEnregistrer, remplace: OperationInventaire | null, apres: () => void) => Promise<void>
  /** Le geste de retrait, sous le verrou de l'onglet ; `apres`, quand la base a retiré. */
  onRetirer: (o: OperationInventaire, apres: () => void) => Promise<void>
}

export default function RegularisationsReprises(p: Props) {
  const { exercice, ctx, donnees, balance, justificatifs, enCours } = p
  const [saisie, setSaisie] = useState<FormulaireDeLaReprise>(() => formulaireDeRepriseVide('cca'))
  const [remplace, setRemplace] = useState<OperationInventaire | null>(null)

  const entete = <strong>Régularisations reprises de la balance — pièce « {pieceDeLaReprise(exercice)} »</strong>

  if (balance === null || balance.etat === 'absente') {
    return <div className="card" style={{ marginBottom: 20 }}>{entete}<p className="muted" style={{ margin: '6px 0 0' }}>Chargement de la balance reprise…</p></div>
  }
  if (balance.etat === 'incomplete') {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        {entete}
        <BandeauLecturePartielle
          quoi="La balance reprise" accord="lue" motif={balance.motif}
          consequence="Aucune régularisation reprise ne se saisit ni ne se retire d’ici, et ce que la validation retiendra ne se dit pas : recharge la page."
        />
      </div>
    )
  }

  const ouverture = ouvertureDeLaBalance(balance.lignes)
  if (!repriseOuverteSur(exercice, ouverture)) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        {entete}
        <p className="muted" style={{ margin: '6px 0 0' }}>
          {ouverture === null
            ? 'Le dossier n’a pas de balance reprise : aucune régularisation reprise.'
            : `La balance reprise ouvre le dossier au ${formatDate(ouverture)}, pas au 1er janvier ${exercice} : une régularisation reprise ne s’y saisit pas.`}
        </p>
      </div>
    )
  }

  const reprises = reprisesDeLExercice(donnees.operations, exercice)
  const retenus = ceQueLaValidationRetiendra(balance.lignes, donnees, exercice)
  const comptesProposes = comptesDeLaBalancePourLaNature(balance.lignes, saisie.nature)
  // Un remplacement garde le compte qu'il cite, même si la balance ne le porte plus : la base le confrontera au solde repris.
  const compteHorsDeLaBalance = saisie.compteRegularisation !== '' && !comptesProposes.some((c) => c.compte === saisie.compteRegularisation)
  const verdict = verdictDeLaReprise(saisie, ctx, donnees, ouverture, remplace, justificatifs)
  const avecTva = natureAvecTvaDAttente(saisie.nature, ctx.assujettiTva)
  const options = justificatifs === null ? [] : optionsDeCitation({ pieces: piecesCitablesParUneRegularisation(justificatifs), factures: [] })
  const citee: Citation | null = saisie.pieceCitee === null ? null : { genre: 'piece', id: saisie.pieceCitee }
  const charge = saisie.nature === 'cca' || saisie.nature === 'fnp'

  const champ = <K extends keyof FormulaireDeLaReprise>(cle: K, valeur: FormulaireDeLaReprise[K]) => setSaisie((f) => ({ ...f, [cle]: valeur }))
  const remettre = () => { setSaisie((f) => formulaireDeRepriseVide(f.nature)); setRemplace(null) }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      {entete}
      <p className="muted" style={{ margin: '6px 0 8px' }}>
        La balance reprise ouvre l’exercice {exercice} au 1er janvier. Une charge ou un produit constaté d’avance, une facture non
        parvenue ou à établir de l’ancien logiciel qu’elle porte se reprend ici, une ligne par régularisation : sa constatation est
        dans la balance, <strong>seule l’extourne au 1er janvier {exercice} s’écrit</strong>, au journal des opérations diverses, sous
        la pièce « {pieceDeLaReprise(exercice)} ». Le compte se choisit parmi ceux de la balance.
      </p>

      <div aria-label="Ce que la validation retiendra" role="group" style={{ marginBottom: 12 }}>
        {retenus.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Les extournes enregistrées soldent chaque compte de régularisation repris : la validation de l’exercice {exercice} n’en retient aucun.
          </p>
        ) : (
          <>
            <p style={{ margin: '0 0 4px', color: 'var(--color-warning)' }}>
              La validation de l’exercice {exercice} retiendra {retenus.length} compte(s) repris que les extournes ne soldent pas :
            </p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {retenus.map((c) => (
                <li key={c.compte}>
                  {c.compte} : repris {soldeDit(c.reprisCentimes)}, il en reste {soldeDit(c.resteCentimes)} au 01/01/{exercice}.
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {reprises.length > 0 && (
        <div className="table-scroll" style={{ marginBottom: 12 }}>
          <div className="tableau-adaptable">
            <table className="table-empilable-etroite table-empilable">
              <caption className="muted" style={{ textAlign: 'left', padding: '6px 0' }}>Régularisations reprises de la balance</caption>
              <thead>
                <tr><th>Nature</th><th>Objet</th><th>Comptes</th><th>Montant</th><th>Pièce</th><th>Extourne</th><th></th></tr>
              </thead>
              <tbody>
                {reprises.map((o) => {
                  const refusRetrait = refusDuRetraitDeLOperation(o, ctx, donnees.operations)
                  return (
                    <tr key={o.id}>
                      <td data-libelle="Nature">{LIBELLES_DES_NATURES[o.nature]}</td>
                      <td data-libelle="Objet">{o.objet}</td>
                      <td data-libelle="Comptes">{o.compte_resultat} / {o.compte_regularisation}</td>
                      <td data-libelle="Montant">
                        {euros(o.montant_centimes)}
                        {o.tva_centimes > 0 && <span className="muted"> + {euros(o.tva_centimes)} de TVA d’attente</span>}
                      </td>
                      <td data-libelle="Pièce">Inventaire {o.exercice}</td>
                      <td data-libelle="Extourne">
                        {ecrituresAJour(o, donnees)
                          ? <span className="badge badge-neutral">À jour</span>
                          : <span className="badge badge-neutral" title="L’extourne n’est plus celle que la régularisation reprise commande : l’enregistrer de nouveau avant la validation.">À recomposer</span>}
                      </td>
                      <td className="td-boutons">
                        <button
                          type="button" className="btn btn-outline btn-sm" disabled={enCours || refusRetrait !== null} title={refusRetrait ?? undefined}
                          onClick={() => { setRemplace(o); setSaisie(formulaireDeLaRepriseLue(o)) }}
                        >
                          Remplacer
                        </button>
                        <button
                          type="button" className="btn btn-outline btn-sm" disabled={enCours || refusRetrait !== null} title={refusRetrait ?? undefined}
                          onClick={() => void p.onRetirer(o, () => { if (remplace?.id === o.id) remettre() })}
                        >
                          Retirer
                        </button>
                        {refusRetrait !== null && <span className="muted">{refusRetrait}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Un vrai formulaire : « Entrée » dans un champ l'envoie, et son nom le distingue de celui des régularisations de l'exercice. */}
      <form
        aria-label="Saisie d’une régularisation reprise"
        onSubmit={(e) => {
          e.preventDefault()
          if (verdict.etat === 'permis') void p.onEnregistrer(verdict, remplace, remettre)
        }}
      >
        <strong>{remplace === null ? 'Reprendre une régularisation de la balance' : `Remplacer la reprise « ${remplace.objet} »`}</strong>
        <div className="field-row aligne-bas" style={{ marginTop: 10 }}>
          <div className="field">
            <label htmlFor="rep-nature">Nature reprise</label>
            <select
              id="rep-nature" value={saisie.nature} disabled={remplace !== null}
              onChange={(e) => setSaisie((f) => ({ ...f, nature: e.target.value as NatureReprise, compteRegularisation: '', tva: '' }))}
            >
              {NATURES_DE_LA_REPRISE.map((n) => <option key={n} value={n}>{LIBELLES_DES_NATURES[n]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rep-compte">Compte de la balance qu’elle extourne</label>
            <select
              id="rep-compte" value={saisie.compteRegularisation} disabled={comptesProposes.length === 0 && !compteHorsDeLaBalance}
              onChange={(e) => champ('compteRegularisation', e.target.value)}
            >
              <option value="">— choisir —</option>
              {comptesProposes.map((c) => <option key={c.compte} value={c.compte}>{c.compte} — repris {soldeDit(c.soldeCentimes)}</option>)}
              {compteHorsDeLaBalance && <option value={saisie.compteRegularisation}>{saisie.compteRegularisation} — absent de la balance</option>}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rep-resultat">{charge ? 'Compte de charge (classe 6)' : 'Compte de produit (classe 7)'}</label>
            <input id="rep-resultat" type="text" inputMode="numeric" autoComplete="off" placeholder={charge ? 'ex. 616000' : 'ex. 706100'} value={saisie.compteResultat} onChange={(e) => champ('compteResultat', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rep-montant">{ctx.assujettiTva ? 'Montant hors taxes repris' : 'Montant toutes taxes comprises repris'}</label>
            <input id="rep-montant" type="text" inputMode="decimal" autoComplete="off" placeholder="ex. 1 200,00" value={saisie.montant} onChange={(e) => champ('montant', e.target.value)} />
          </div>
          {avecTva && (
            <div className="field">
              <label htmlFor="rep-tva">TVA d’attente reprise</label>
              <input id="rep-tva" type="text" inputMode="decimal" autoComplete="off" placeholder="ex. 240,00" value={saisie.tva} onChange={(e) => champ('tva', e.target.value)} />
            </div>
          )}
        </div>
        {comptesProposes.length === 0 && (
          <p className="muted" style={{ margin: '0 0 8px' }}>
            La balance reprise ne porte aucun compte sous le {racinesDites(saisie.nature)} : rien à reprendre pour cette nature.
          </p>
        )}
        <div className="field-row aligne-bas">
          <div className="field">
            <label htmlFor="rep-objet">Objet de la reprise (il part au FEC)</label>
            <input id="rep-objet" type="text" autoComplete="off" maxLength={200} placeholder="ex. Assurance du local, reprise" value={saisie.objet} onChange={(e) => champ('objet', e.target.value)} />
          </div>
        </div>
        <ChoixDuJustificatif
          id="rep-justificatif" lecture={p.lectureDesJustificatifs} options={options}
          citee={citee} optionCitee={optionCitee(citee, justificatifs)} quoi="une pièce"
          desactive={enCours} onChoisir={(c) => champ('pieceCitee', c === null ? null : c.id)}
        />
        {verdict.etat === 'refuse' && saisie.objet.trim() !== '' && (
          <ul className="error-text" role="alert" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
            {verdict.refus.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        {verdict.etat === 'permis' && (
          <p className="muted" style={{ margin: '0 0 8px' }}>
            Seule l’extourne au {formatDate(verdict.extourne.date)} s’écrit : « {verdict.extourne.libelle} ».
          </p>
        )}
        <div className="fiche-mouvement-boutons" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="submit" className="btn btn-primary btn-sm" disabled={enCours || verdict.etat !== 'permis'}
            title={verdict.etat === 'refuse' ? verdict.refus[0] : undefined}
          >
            {remplace === null ? 'Enregistrer la reprise' : 'Remplacer la reprise'}
          </button>
          {remplace !== null && (
            <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => remettre()}>
              Annuler le remplacement de la reprise
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
