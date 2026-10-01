import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, formatDate, formatMoney } from '../../lib/format'
import type { EcritureBrouillon, LigneBancaire } from '../../lib/types'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import { lireTout } from '../../lib/lectureComplete'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { LIBELLES_COMPTES } from '../../lib/comptes'
import type { ModeleComptable } from '../../lib/engagement'
import { compteDuDirigeant, ecritureDuVirementPersonnel, virementsPersonnelsAEcrire } from '../../lib/virementPersonnel'
import { messageErreur } from '../../lib/messageErreur'

// Les virements entre le compte pro et le compte personnel de l'exploitant, marqués depuis l'onglet
// Banque (bouton « Virement personnel » sur un mouvement non rapproché) : ses prélèvements, et ses
// apports. Pas de saisie indépendante : un virement personnel n'a par nature aucun justificatif à
// déposer, le marquage se fait sur le mouvement lui-même.
//
// ET IL S'ÉCRIT (lib/virementPersonnel.ts) : sur le compte du dirigeant, face à la banque. Ce classement
// n'écrivait rien jusqu'au 29/09/2026 ; les virements marqués avant n'ont donc pas d'écriture — ils
// manquent au FEC, et la trésorerie de l'application ne retrouve pas le relevé. Cet écran les montre et
// les écrit, sur un clic.
//
// `modele` : le modèle comptable du dossier, qui décide du compte (108 en trésorerie ; en engagement,
// celui que le cabinet a choisi pour le dirigeant).
export default function VirementsTab({ dossierId, modele }: { dossierId: string; modele: ModeleComptable }) {
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  const [loading, setLoading] = useState(true)
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')
  const [recherche, setRecherche] = useState('')
  // Non nuls quand une liste n'a pas pu être lue en entier — voir lib/lectureComplete.ts.
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  const [lectureEcritures, setLectureEcritures] = useState<string | null>(null)
  // UN verrou pour les deux gestes qui écrivent : « Écrire les N » et « Retirer ». Retiré pendant que
  // le lot tourne, un virement serait reclassé par le lot, qui l'a pris avant — la fonction de la base
  // accepte un mouvement à traiter. Un `useRef`, posé avant le premier `await` : un état React laisse
  // passer deux clics du même rendu (voir CLAUDE.md, « un verrou d'exécution »).
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)

  async function load() {
    setLoading(true)
    // Lue par tranches (voir lib/lectureComplete.ts) : cette liste est petite aujourd'hui, mais
    // elle porte un TOTAL — et un total calculé sur une lecture tronquée a l'air d'un total.
    const [lecture, lectureDesEcritures] = await Promise.all([
      lireTout<LigneBancaire>((debut, fin) =>
        supabase.from('lignes_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId)
          .eq('prelevement_personnel', true)
          .order('date', { ascending: false }).order('id').range(debut, fin),
      ),
      // Les écritures SANS PIÈCE du dossier : celles des virements personnels et des mouvements
      // affectés. Lues pour savoir quels virements n'ont pas la leur.
      lireTout<EcritureBrouillon>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).is('piece_id', null)
          .order('id').range(debut, fin),
      ),
    ])
    setLignes(lecture.lignes)
    setLectureIncomplete(lecture.complete ? null : lecture.motif)
    setEcritures(lectureDesEcritures.lignes)
    setLectureEcritures(lectureDesEcritures.complete ? null : lectureDesEcritures.motif)
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  const compte = compteDuDirigeant(modele)
  const libelleCompte = LIBELLES_COMPTES[compte] ?? compte
  const aEcrire = virementsPersonnelsAEcrire(ecritures, lignes, modele)
  const idsAEcrire = new Set(aEcrire.map((l) => l.id))
  const idsAvecEcriture = new Set(ecritures.map((e) => e.ligne_bancaire_id))
  // UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE (voir CLAUDE.md) : un virement dont l'écriture n'a
  // pas été lue paraîtrait sans écriture, et la liste de ceux à écrire serait fausse dans un sens ou
  // dans l'autre. Le geste se suspend et dit pourquoi.
  const ecritureSuspendue = lectureIncomplete ?? lectureEcritures

  // Chaque virement par la même fonction de la base que le bouton de Banque : elle vérifie l'écriture
  // et l'écrit avec le classement, et remplace celle qui ne correspond plus. Un échec n'interrompt pas
  // le lot, et se dit. Le verrou se relâche APRÈS la relecture : relâché avant, la liste montrerait
  // encore « Écrire les N » sur des virements déjà écrits, le temps qu'elle revienne.
  async function ecrireLesVirements() {
    if (ecritureEnCours.current || ecritureSuspendue || aEcrire.length === 0) return
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const echecs: string[] = []
      for (const ligne of aEcrire) {
        const { error } = await supabase.rpc('classer_virement_personnel', {
          p_ligne_bancaire_id: ligne.id,
          p_ecritures: ecritureDuVirementPersonnel(ligne, modele),
        })
        if (error) echecs.push(messageErreur(error, 'raison inconnue'))
      }
      if (echecs.length > 0) {
        window.alert(
          `${aEcrire.length - echecs.length} virement(s) écrit(s) sur ${aEcrire.length}. `
          + `${echecs.length} n’ont pas pu l’être : ${echecs[0]}`,
        )
      }
      await load()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  // Remet le mouvement à traiter ET retire son écriture, par la base (`retirer_virement_personnel`) :
  // une simple mise à jour laisserait l'écriture derrière lui, sans plus rien qui la justifie.
  async function retirer(ligneId: string) {
    if (ecritureEnCours.current) return
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const { error } = await supabase.rpc('retirer_virement_personnel', { p_ligne_bancaire_id: ligneId })
      if (error) window.alert(`Le virement n’a pas pu être retiré : ${messageErreur(error, 'raison inconnue')}`)
      await load()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  const anneesDisponibles = [...new Set(lignes.map((l) => anneeDe(l.date)))].sort((a, b) => b - a)
  const filtered = anneeFilter === 'toutes' ? lignes : lignes.filter((l) => anneeDe(l.date) === anneeFilter)

  // La recherche ne filtre que les lignes affichées : le total prélevé ci-dessous reste celui de
  // l'année sélectionnée. Un « total » qui suivrait le texte tapé ne voudrait plus rien dire.
  const affichees = filtered.filter((l) =>
    correspondALaRecherche([l.libelle, l.montant, l.date, formatDate(l.date)], recherche),
  )
  // LE SIGNE SE PERD DANS LE TOTAL, ET NULLE PART AILLEURS. La ligne affiche `formatMoney(montant)`,
  // donc une entrée s'y voit ; le total, lui, sommait des VALEURS ABSOLUES. Or le bouton « Virement
  // personnel » de l'onglet Banque n'est borné par aucun signe, et c'est le seul qui nomme la
  // situation d'un mouvement venu du compte personnel — un apport marqué ainsi FAISAIT MONTER le
  // « Total prélevé » au lieu de le réduire, sous un libellé qui dit l'inverse.
  // Un apport s'écrit au CRÉDIT du compte du dirigeant, un prélèvement à son débit : on l'écarte d'un
  // total qui ne le désigne pas, et on le DIT — un encaissement classé ici par erreur manquerait aux
  // recettes.
  const prelevements = filtered.filter((l) => l.montant < 0)
  const apports = filtered.filter((l) => l.montant > 0)
  const total = prelevements.reduce((s, l) => s + Math.abs(l.montant), 0)
  const totalApports = apports.reduce((s, l) => s + l.montant, 0)

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les virements personnels"
        accord="lus"
        motif={lectureIncomplete}
        consequence="Le total ci-dessous porte donc sur une partie d’entre eux, et leur écriture est suspendue."
      />
      <BandeauLecturePartielle
        quoi="Les écritures des virements personnels"
        accord="lues"
        motif={lectureEcritures}
        consequence="Un virement peut paraître sans écriture alors qu’il en a une : leur écriture est suspendue."
      />

      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Virements entre le compte pro et le compte personnel de l’exploitant — ni charges ni recettes :
        ils s’écrivent sur le compte {compte} ({libelleCompte}), face à la banque. Un mouvement se marque
        comme tel depuis l’onglet Banque (« Virement personnel » sur une ligne non rapprochée) ;
        « Retirer » le remet à traiter et retire son écriture.
      </p>

      {aEcrire.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <strong>
            {aEcrire.length === 1
              ? '1 virement personnel sans son écriture'
              : `${aEcrire.length} virements personnels sans leur écriture`}
          </strong>
          <p className="muted" style={{ margin: '6px 0 10px' }}>
            Un virement classé avant que ce classement s’écrive n’a pas d’écriture : il manque au FEC, et la
            trésorerie de l’application ne retrouve pas le relevé. Le bouton écrit chacun sur le compte{' '}
            {compte}, face à la banque.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={enCours || !!ecritureSuspendue}
            onClick={ecrireLesVirements}
          >
            {enCours ? 'Écriture…' : aEcrire.length === 1 ? 'Écrire ce virement' : `Écrire les ${aEcrire.length}`}
          </button>
          {ecritureSuspendue && (
            <p className="muted" style={{ margin: '8px 0 0' }}>
              Suspendu : la lecture est partielle ({ecritureSuspendue}), et ce compte peut être faux.
              Recharge la page.
            </p>
          )}
        </div>
      )}

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

      {filtered.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <span className="muted" style={{ display: 'block' }}>Total prélevé{anneeFilter !== 'toutes' ? ` en ${anneeFilter}` : ''}</span>
          <strong style={{ fontSize: '1.3rem' }}>{formatMoney(total)}</strong>
          {/* Rendu seulement quand il apprend quelque chose — une mise en garde permanente cesse
              d'être lue, puis emporte ses voisines (voir `detailPiecesSansDate`). */}
          {apports.length > 0 && (
            <p className="muted" style={{ marginTop: 8, marginBottom: 0, color: 'var(--color-danger)' }}>
              {apports.length} mouvement(s) ENTRANT(s), pour {formatMoney(totalApports)}, ne sont pas
              comptés ci-dessus : un virement <em>vers</em> le compte pro est un apport, pas un
              prélèvement — il crédite le compte {compte}. Vérifie ce marquage dans l'onglet Banque : un
              encaissement classé ici par erreur manquerait aux recettes.
            </p>
          )}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un libellé, un montant…"
          affiches={affichees.length}
          total={filtered.length}
        />
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : affichees.length === 0 ? (
          <div className="empty-state">
            {recherche.trim()
              ? `Aucun virement ne correspond à « ${recherche.trim()} ».`
              : lectureIncomplete
                // Le vide d'une liste qu'on n'a pas pu lire n'est pas une réponse : le bandeau dit pourquoi.
                ? 'Les virements personnels n’ont pas pu être lus.'
                : "Aucun virement personnel marqué pour l'instant."}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Libellé</th>
                <th>Montant</th>
                <th>Écriture</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {affichees.map((l) => (
                <tr key={l.id}>
                  <td>{formatDate(l.date)}</td>
                  <td>{l.libelle}</td>
                  <td>{formatMoney(l.montant)}</td>
                  <td>
                    {/* Sur une lecture partielle des écritures, on ne sait pas : on ne dit rien plutôt
                        que d'annoncer « sans écriture » un virement dont l'écriture n'a pas été lue. */}
                    {lectureEcritures
                      ? <span className="muted">—</span>
                      : idsAEcrire.has(l.id)
                        ? <span className="badge badge-warning">{idsAvecEcriture.has(l.id) ? 'À réécrire' : 'Sans écriture'}</span>
                        : l.montant === 0
                          ? <span className="muted">Rien à écrire</span>
                          : <span className="badge badge-ok">Compte {compte}</span>}
                  </td>
                  <td>
                    <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => retirer(l.id)}>
                      Retirer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
