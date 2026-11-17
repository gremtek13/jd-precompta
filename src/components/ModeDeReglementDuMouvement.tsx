import { useState } from 'react'
import {
  libelleDuMode, MODE_ILLISIBLE_DIT, MODE_NON_POSE_DIT, MODES_D_UN_MOUVEMENT, raisonDeLaProposition, type ModeDeLaFiche,
  type ModeDUnMouvement,
} from '../lib/modeDeReglement'

// LE MODE DE RÈGLEMENT D'UN MOUVEMENT, DANS SA FICHE (EXP58-Q1 ; lib/modeDeReglement.ts). L'état se calcule dans le module
// (`modeDeLaFiche`) ; ce composant le dit et offre deux gestes, qui passent tous deux par `onPoser` — l'onglet Banque écrit par
// `poser_modes_de_reglement` SEULE, sous le verrou des écritures du relevé, relâché après la relecture :
//   - « Poser « … » » : le mode que le libellé de la banque propose, sur un clic, jamais sans lui ;
//   - « Enregistrer » : le mode choisi dans la liste fermée, ou « aucun », qui retire celui qui était posé.
// Figé par un exercice validé, ou lu sans sa colonne, aucun geste. Le refus de la base se dit sous la section.

interface Props {
  fiche: ModeDeLaFiche
  // Le montant du mouvement : les espèces disent leur sens (un versement, un retrait).
  montant: number
  // Une écriture est en cours sur le relevé (le verrou de l'onglet) : les gestes attendent.
  occupe: boolean
  erreur: string | null
  onPoser: (mode: ModeDUnMouvement | null) => void
}

export default function ModeDeReglementDuMouvement({ fiche, montant, occupe, erreur, onPoser }: Props) {
  // Le choix part du mode posé, sinon de celui que le libellé propose, sinon d'« aucun ».
  const depart = fiche.etat === 'ouvert' ? (fiche.mode ?? fiche.proposition?.mode ?? '') : ''
  const [choisi, setChoisi] = useState<ModeDUnMouvement | ''>(depart)
  if (fiche.etat === 'absent') return null
  const pose = fiche.etat === 'ouvert' || fiche.etat === 'fige' ? fiche.mode : null
  const inchange = choisi === (pose ?? '')
  return (
    <section className="fiche-mouvement-section" aria-label="Mode de règlement">
      <h3>Mode de règlement</h3>
      {fiche.etat === 'illisible' && <p className="fiche-mouvement-alerte">{MODE_ILLISIBLE_DIT}</p>}
      {fiche.etat === 'fige' && (
        <p className="fiche-mouvement-note">
          {pose ? `Posé : ${libelleDuMode(pose, montant)}.` : MODE_NON_POSE_DIT} {fiche.figeePar} : il ne change plus.
        </p>
      )}
      {fiche.etat === 'ouvert' && (
        <>
          <p className="fiche-mouvement-note">{pose ? `Posé : ${libelleDuMode(pose, montant)}.` : MODE_NON_POSE_DIT}</p>
          {fiche.proposition && (
            <div className="fiche-mouvement-choix">
              <p className="fiche-mouvement-note">
                Proposé : {libelleDuMode(fiche.proposition.mode, montant)} — {raisonDeLaProposition(fiche.proposition)}. Rien ne
                s’écrit sans ton clic.
              </p>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={occupe}
                onClick={() => { if (fiche.proposition) onPoser(fiche.proposition.mode) }}
              >
                Poser « {fiche.proposition.mode} »
              </button>
            </div>
          )}
          <div className="field">
            <label htmlFor="mode-de-reglement">{pose ? 'Corriger le mode' : 'Choisir le mode'}</label>
            <div className="fiche-mouvement-choix">
              <select id="mode-de-reglement" value={choisi} onChange={(e) => setChoisi(e.target.value as ModeDUnMouvement | '')}>
                <option value="">Aucun (le FEC écrit « Banque »)</option>
                {MODES_D_UN_MOUVEMENT.map((m) => <option key={m} value={m}>{libelleDuMode(m, montant)}</option>)}
              </select>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={occupe || inchange}
                onClick={() => onPoser(choisi === '' ? null : choisi)}
              >
                {choisi === '' && pose ? 'Retirer le mode' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </>
      )}
      {erreur && <p className="fiche-mouvement-alerte" role="alert">Le mode n’a pas été enregistré : {erreur}</p>}
    </section>
  )
}
