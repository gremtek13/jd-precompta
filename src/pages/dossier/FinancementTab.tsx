import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { lireTout } from '../../lib/lectureComplete'
import { messageErreur } from '../../lib/messageErreur'
import { ajouterMois, anneeDe, aujourdHuiSql, formatDate, formatMoney } from '../../lib/format'
import { COMPTE_BANQUE } from '../../lib/comptes'
import { capitalRestantDu, empruntActif, genererEcheancier, type Emprunt } from '../../lib/emprunts'
import { calculerSituationIntermediaire, moisEcoulesDeLAnnee } from '../../lib/situationIntermediaire'
import { partsDuReleve, type PartDuReleve } from '../../lib/partsDuReleve'
import { calculerPlanTresorerie, echeancesCotisations, echeancesEmprunts, reserveSurMoyenne, reserveSurSolde, soldeBanqueADate, type EcheanceConnue, type OuvertureBanque } from '../../lib/planTresorerie'
import { ouvertureBanque } from '../../lib/aNouveaux'
import { calculerRatiosBancaires } from '../../lib/ratiosBancaires'
import { calculerPrevisionnel, type PrevisionnelBancaire } from '../../lib/previsionnel'
import { echeancesOccupees, idsDeblocagesEmprunt } from '../../lib/echeanceEmprunt'
import type {
  ANouveau, Categorie, CotisationDeclaree, Immobilisation, LigneBancaire, ModeComptable, Piece, VentilationBancaire,
} from '../../lib/types'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'

// `ligne_bancaire_id` : le mouvement du relevé dont l'écriture est la contrepartie — de quoi reconnaître
// celles d'un DÉBLOCAGE d'emprunt, que le solde compte et la moyenne des encaissements non.
interface LigneBanque { date: string; sens: 'debit' | 'credit'; montant: number; ligne_bancaire_id: string | null }

// Première brique du "dossier bancaire automatisé" — l'échéancier des emprunts (voir lib/emprunts.ts),
// avec quelques ratios simples qui ne demandent pas de résoudre au préalable la question, plus large,
// d'un bilan complet par régime (BNC/société) : trésorerie et capacité de remboursement se calculent
// pareil dans les deux cas à partir du compte banque et des mensualités. La balance complète (tous
// comptes) reste dans l'onglet Statistiques plutôt que dupliquée ici — la situation intermédiaire
// ci-dessous s'en distingue : un état "à ce jour" regroupé par poste 2035 (comme Clôture), pas un
// tableau brut par compte.
// `modeComptable` : en engagement, la situation intermédiaire, les ratios et le prévisionnel comptent
// une pièce à la date de sa FACTURE, et non de son paiement (lib/rattachement.ts, `rattachements`).
export default function FinancementTab({ dossierId, assujettiTva, modeComptable }: { dossierId: string; assujettiTva: boolean; modeComptable: ModeComptable }) {
  const [emprunts, setEmprunts] = useState<Emprunt[]>([])
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  const [piecesValidees, setPiecesValidees] = useState<Piece[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [lignesBanque, setLignesBanque] = useState<LigneBanque[]>([])
  // Les mouvements RAPPROCHÉS d'une pièce, qui la datent (voir lib/rattachement.ts) — à ne pas
  // confondre avec `lignesBanque`, les écritures du compte 512 dont sort la trésorerie.
  const [paiements, setPaiements] = useState<LigneBancaire[]>([])
  // Les parts des mouvements ventilés sur plusieurs comptes (lib/ventilationBanque.ts), que la situation
  // intermédiaire, les ratios et le prévisionnel comptent comme la 2035.
  const [ventilations, setVentilations] = useState<VentilationBancaire[]>([])
  // Le solde de la banque à l'ouverture d'un dossier repris d'un autre logiciel (voir
  // lib/aNouveaux.ts) : sans lui, la trésorerie part de zéro à la première écriture.
  const [ouverture, setOuverture] = useState<OuvertureBanque | null>(null)
  // À part de `lectureIncomplete` : une ouverture lue à moitié fausse la trésorerie, et elle seule —
  // le préremplissage du prévisionnel, que l'autre drapeau suspend, ne la lit pas.
  const [ouvertureIncomplete, setOuvertureIncomplete] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Emprunt | 'new' | null>(null)
  const [echeancierDe, setEcheancierDe] = useState<Emprunt | null>(null)
  const [situationOuverte, setSituationOuverte] = useState(false)
  const [tresorerieOuverte, setTresorerieOuverte] = useState(false)
  const [dettesOuvertes, setDettesOuvertes] = useState(false)
  const [previsionnel, setPrevisionnel] = useState<PrevisionnelBancaire | null>(null)
  // Non nul = on ne SAIT PAS s'il existe un prévisionnel enregistré. Distinct de « il n'y en a
  // pas » : l'enregistrement est un upsert qui porte TOUS les champs (voir PrevisionnelModal).
  const [previsionnelIllisible, setPrevisionnelIllisible] = useState<string | null>(null)
  const [previsionnelOuvert, setPrevisionnelOuvert] = useState(false)

  async function load() {
    setLoading(true)
    const [
      lectureEmprunts,
      lecturePieces,
      lectureCategories,
      lectureImmobilisations,
      lectureCotisations,
      lectureBanque,
      lectureANouveaux,
      lecturePaiements,
      { data: previsionnelData, error: previsionnelError },
      lectureVentilations,
    ] = await Promise.all([
      lireTout<Emprunt>((debut, fin) =>
        supabase.from('emprunts').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date_debut', { ascending: false }).order('id').range(debut, fin),
      ),
      // Lues par tranches (voir lib/lectureComplete.ts) : recettes et charges font la situation
      // intermédiaire, les ratios bancaires et le plan de trésorerie — trois chiffres qu'un banquier
      // regarde.
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
      ),
      lireTout<Categorie>((debut, fin) =>
        supabase.from('categories').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
      ),
      lireTout<Immobilisation>((debut, fin) =>
        supabase.from('immobilisations').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<CotisationDeclaree>((debut, fin) =>
        supabase.from('cotisations_declarees').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Solde de trésorerie recalculé depuis le détail (pas juste l'agrégat "aujourd'hui") pour
      // pouvoir aussi répondre "à telle date" dans la situation intermédiaire ci-dessous — sur tout
      // l'historique du brouillon d'écritures, comme un relevé, pas borné à l'année en cours.
      lireTout<{ date: string; sens: string; montant: number; ligne_bancaire_id: string | null }>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('date, sens, montant, ligne_bancaire_id', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('compte', COMPTE_BANQUE).order('id').range(debut, fin),
      ),
      lireTout<ANouveau>((debut, fin) =>
        supabase.from('a_nouveaux').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('compte').order('id').range(debut, fin),
      ),
      // Les paiements qui DATENT les pièces de la situation intermédiaire, des ratios et du
      // préremplissage du prévisionnel : une pièce compte dans la période de son paiement, la règle de
      // la 2035. Et les mouvements AFFECTÉS à une catégorie sans justificatif (ligne 26.6), qui comptent
      // eux-mêmes — sans eux, l'état montré à une banque perdait les encaissements sans bordereau.
      // Tronquée, cette lecture fausse les mêmes chiffres que les six autres, donc le même drapeau.
      lireTout<LigneBancaire>((debut, fin) =>
        supabase.from('lignes_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'rapprochee')
          .order('id').range(debut, fin),
      ),
      // QUATRIÈME COPIE DE « LECTURE → FORMULAIRE → UPSERT DE TOUS LES CHAMPS », par la porte que
      // le scanner ne regardait pas : une entrée de `Promise.all` s'écrit sans `await`. Les trois
      // premières (InformationsTab, ClientInformations, CabinetBrandingPage) sont corrigées depuis
      // le 21/09/2026 ; celle-ci jetait encore son erreur, donc une lecture refusée rendait
      // `previsionnel` nul — exactement l'écran d'un dossier qui n'a jamais rien enregistré, bouton
      // « Générer » compris — et le premier enregistrement écrasait les deux taux ET
      // `note_hypotheses`, du texte libre que personne ne relit donc que personne ne verrait partir.
      supabase.from('previsionnels_bancaires').select('*').eq('dossier_id', dossierId).maybeSingle(),
      // Les parts des mouvements VENTILÉS : elles vivent dans leur propre table, et comptent dans les
      // mêmes chiffres que les mouvements affectés — donc le même drapeau.
      lireTout<VentilationBancaire>((debut, fin) =>
        supabase.from('ventilations_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
    ])
    setEmprunts(lectureEmprunts.lignes)
    setPiecesValidees(lecturePieces.lignes)
    setCategories(lectureCategories.lignes)
    setImmobilisations(lectureImmobilisations.lignes)
    setCotisations(lectureCotisations.lignes)
    setLignesBanque(lectureBanque.lignes as LigneBanque[])
    setPaiements(lecturePaiements.lignes)
    setVentilations(lectureVentilations.lignes)
    setOuverture(ouvertureBanque(lectureANouveaux.lignes))
    setPrevisionnelIllisible(previsionnelError ? messageErreur(previsionnelError, "Le prévisionnel enregistré n'a pas pu être lu.") : null)
    setPrevisionnel((previsionnelData ?? null) as PrevisionnelBancaire | null)
    // Huit lectures, un seul drapeau : l'écran n'a rien de plus utile à dire selon laquelle a
    // manqué, et chacune fausse les mêmes chiffres.
    setLectureIncomplete(
      [
        lectureEmprunts, lecturePieces, lectureCategories, lectureImmobilisations, lectureCotisations, lectureBanque,
        lecturePaiements, lectureVentilations,
      ].find((l) => !l.complete)?.motif ?? null,
    )
    setOuvertureIncomplete(lectureANouveaux.motif)
    setLoading(false)
  }
  useEffect(() => { load() }, [dossierId])

  const soldeBanque = soldeBanqueADate(lignesBanque, ouverture, aujourdHuiSql())
  // Ce que le relevé ajoute sans pièce aux trois états — mouvements affectés, échéances d'emprunt, parts
  // ventilées (lib/partsDuReleve.ts) —, calculé une fois et passé aux trois fenêtres qui le comptent.
  const partsReleve = partsDuReleve(paiements, categories, ventilations)
  // LES DÉBLOCAGES D'EMPRUNT NE SONT PAS UN RYTHME D'ACTIVITÉ (lib/echeanceEmprunt.ts) : écrits au 512, ils
  // entreraient dans la moyenne des encaissements du plan de trésorerie et flatteraient le taux
  // d'endettement, sur le document qu'on présente à une banque. Le solde, lui, les compte.
  const deblocages = idsDeblocagesEmprunt(paiements)
  const lignesDuRythme = lignesBanque.filter((l) => !l.ligne_bancaire_id || !deblocages.has(l.ligne_bancaire_id))
  const deblocagesEcartes = lignesBanque.length - lignesDuRythme.length

  // Les mouvements rapprochés de chaque emprunt : ses échéances payées, et son déblocage.
  const rapprochementsDe = (e: Emprunt) => paiements.filter((l) => l.emprunt_id === e.id)

  // Un emprunt dont une échéance est rapprochée ne se supprime pas : la clé du relevé vers l'emprunt est
  // SANS action à la suppression, et c'est voulu — ses écritures et sa part de la 2035 en dépendent. Dit
  // AVANT, plutôt qu'une confirmation suivie d'un refus de la base ; et le refus de la base, s'il vient
  // quand même (une lecture partielle, un autre onglet), est lu et dit.
  async function supprimer(e: Emprunt) {
    const rapproches = rapprochementsDe(e)
    if (rapproches.length > 0) {
      window.alert(
        `L’emprunt « ${e.nom} » a ${rapproches.length} mouvement${rapproches.length > 1 ? 's' : ''} du relevé rapproché${rapproches.length > 1 ? 's' : ''} ` +
        '(échéances ou déblocage) : annule d’abord ces rapprochements dans Banque — ils portent ses écritures et sa part de la 2035.',
      )
      return
    }
    if (!window.confirm(`Supprimer l'emprunt "${e.nom}" ? Cette action est irréversible.`)) return
    const { error } = await supabase.from('emprunts').delete().eq('id', e.id)
    if (error) {
      window.alert(error.code === '23503'
        ? `L’emprunt « ${e.nom} » n’a pas été supprimé : des mouvements du relevé y sont rapprochés. Annule d’abord ces rapprochements dans Banque.`
        : `L’emprunt n’a pas pu être supprimé : ${messageErreur(error, 'raison inconnue')}`)
    }
    load()
  }

  const empruntsActifs = emprunts.filter((e) => empruntActif(e))
  const mensualiteTotale = empruntsActifs.reduce((s, e) => s + genererEcheancier(e)[0].mensualite, 0)
  const capitalRestantTotal = empruntsActifs.reduce((s, e) => s + capitalRestantDu(e), 0)

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les données du dossier bancaire"
        motif={lectureIncomplete}
        consequence={
          'Trésorerie, échéancier des dettes, ratios et prévisionnel ci-dessous portent donc sur une ' +
          'partie du dossier. C’est le document qu’on présente à une banque — recharge la page ' +
          'avant de l’éditer.'
        }
      />
      <BandeauLecturePartielle
        quoi="Les à-nouveaux du dossier"
        accord="lus"
        motif={ouvertureIncomplete}
        consequence={
          'La trésorerie ci-dessous — solde actuel, situation intermédiaire, plan — part donc d’une ' +
          'ouverture incomplète. C’est le document qu’on présente à une banque — recharge la page avant ' +
          'de l’éditer.'
        }
      />
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Échéancier des emprunts, situation intermédiaire et quelques ratios utiles pour un dossier
        bancaire. La balance complète (tous comptes, sans regroupement par poste) reste dans l'onglet
        Statistiques — cet écran regroupe plutôt ce qui sert à un banquier.
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="card" style={{ flex: '1 1 200px' }}>
          <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Trésorerie actuelle (banque)</span>
          <strong style={{ fontSize: '1.3rem' }}>{loading ? '—' : formatMoney(soldeBanque)}</strong>
          {!loading && ouverture && (
            <span className="muted" style={{ display: 'block', fontSize: '0.78rem' }}>
              Depuis l’ouverture du {formatDate(ouverture.date)} (à-nouveaux).
            </span>
          )}
        </div>
        <div className="card" style={{ flex: '1 1 200px' }}>
          <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Mensualités en cours (total)</span>
          <strong style={{ fontSize: '1.3rem' }}>{formatMoney(Math.round(mensualiteTotale * 100) / 100)}</strong>
        </div>
        <div className="card" style={{ flex: '1 1 200px' }}>
          <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Capital restant dû (total)</span>
          <strong style={{ fontSize: '1.3rem' }}>{formatMoney(Math.round(capitalRestantTotal * 100) / 100)}</strong>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Situation intermédiaire</h3>
        <button className="btn btn-outline btn-sm" onClick={() => setSituationOuverte(true)}>Générer</button>
      </div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 26 }}>
        Recettes, charges et résultat depuis le 1er janvier jusqu'à une date choisie, regroupés par
        poste 2035 comme dans l'onglet Clôture — un état « à ce jour » sans attendre la fin de
        l'exercice.
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Plan de trésorerie</h3>
        <button className="btn btn-outline btn-sm" onClick={() => setTresorerieOuverte(true)}>Générer</button>
      </div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 26 }}>
        Projection mensuelle du solde bancaire sur les prochains mois, à partir du rythme réel
        d'encaissements/décaissements observé sur l'historique — « si le rythme actuel se maintient »,
        pas un budget poste par poste.
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Dettes & ratios bancaires</h3>
        <button className="btn btn-outline btn-sm" onClick={() => setDettesOuvertes(true)}>Générer</button>
      </div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 26 }}>
        Échéancier consolidé des dettes (emprunts + cotisations sociales) et deux ratios usuels pour
        un dossier bancaire : capacité de remboursement et taux d'endettement mensuel.
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Prévisionnel à 3 ans</h3>
        <button
          className="btn btn-outline btn-sm" onClick={() => setPrevisionnelOuvert(true)}
          disabled={!!previsionnelIllisible}
        >
          {previsionnel ? 'Modifier' : 'Générer'}
        </button>
      </div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 26 }}>
        Projection sur 3 ans par taux de croissance annuel, à partir d'un CA et de charges de
        référence — les hypothèses restent celles du cabinet, jamais devinées par l'application.
        {previsionnel && (
          <> Dernière hypothèse enregistrée : {previsionnel.taux_croissance_ca} % CA / {previsionnel.taux_croissance_charges} % charges par an.</>
        )}
      </p>
      {previsionnelIllisible && (
        <p className="error-text" style={{ marginTop: -20, marginBottom: 26 }}>
          {previsionnelIllisible} Le formulaire reste fermé : il s'enregistre en remplaçant tous ses
          champs, note d'hypothèses comprise, donc l'ouvrir sans avoir lu ce qui existe reviendrait à
          l'effacer. Ce n'est pas « aucun prévisionnel », c'est « on ne sait pas ».
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Emprunts</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>+ Nouvel emprunt</button>
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : emprunts.length === 0 ? (
          <div className="empty-state">Aucun emprunt enregistré.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Nom</th><th className="hide-mobile">Organisme</th><th>Capital initial</th><th className="hide-mobile">Taux</th><th>Mensualité</th><th>Restant dû</th><th></th></tr>
            </thead>
            <tbody>
              {emprunts.map((e) => {
                const mensualite = genererEcheancier(e)[0].mensualite
                const restant = capitalRestantDu(e)
                return (
                  <tr key={e.id}>
                    <td>
                      {e.nom}
                      {!empruntActif(e) && <div className="muted" style={{ fontSize: '0.78rem' }}>Soldé</div>}
                    </td>
                    <td className="hide-mobile">{e.organisme_preteur ?? '—'}</td>
                    <td>{formatMoney(e.capital_initial)}</td>
                    <td className="hide-mobile">{`${String(e.taux_annuel).replace('.', ',')} %`}</td>
                    <td>{formatMoney(mensualite)}</td>
                    <td>{formatMoney(restant)}</td>
                    <td className="td-actions">
                      <button className="btn btn-outline btn-sm" onClick={() => setEcheancierDe(e)}>Échéancier</button>
                      <button className="btn btn-outline btn-sm" onClick={() => setEditing(e)}>Modifier</button>
                      <button className="btn btn-danger btn-sm" onClick={() => supprimer(e)}>Supprimer</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <EmpruntFormModal
          dossierId={dossierId}
          emprunt={editing === 'new' ? null : editing}
          rapprochements={editing === 'new' ? [] : rapprochementsDe(editing)}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      {echeancierDe && (
        <EcheancierModal emprunt={echeancierDe} rapprochements={rapprochementsDe(echeancierDe)} onClose={() => setEcheancierDe(null)} />
      )}

      {situationOuverte && (
        <SituationIntermediaireModal
          assujettiTva={assujettiTva}
          modeComptable={modeComptable}
          piecesValidees={piecesValidees}
          paiements={paiements}
          partsReleve={partsReleve}
          categories={categories}
          immobilisations={immobilisations}
          cotisations={cotisations}
          lignesBanque={lignesBanque}
          ouverture={ouverture}
          onClose={() => setSituationOuverte(false)}
        />
      )}

      {tresorerieOuverte && (
        <PlanTresorerieModal
          lignesBanque={lignesBanque}
          lignesDuRythme={lignesDuRythme}
          deblocagesEcartes={deblocagesEcartes}
          ouverture={ouverture}
          soldeActuel={soldeBanque}
          emprunts={emprunts}
          cotisations={cotisations}
          onClose={() => setTresorerieOuverte(false)}
        />
      )}

      {dettesOuvertes && (
        <DettesRatiosModal
          assujettiTva={assujettiTva}
          modeComptable={modeComptable}
          piecesValidees={piecesValidees}
          paiements={paiements}
          partsReleve={partsReleve}
          categories={categories}
          immobilisations={immobilisations}
          cotisations={cotisations}
          emprunts={emprunts}
          lignesDuRythme={lignesDuRythme}
          deblocagesEcartes={deblocagesEcartes}
          capitalRestantTotal={capitalRestantTotal}
          mensualiteTotale={mensualiteTotale}
          onClose={() => setDettesOuvertes(false)}
        />
      )}

      {previsionnelOuvert && (
        <PrevisionnelModal
          dossierId={dossierId}
          assujettiTva={assujettiTva}
          modeComptable={modeComptable}
          previsionnel={previsionnel}
          piecesValidees={piecesValidees}
          paiements={paiements}
          partsReleve={partsReleve}
          categories={categories}
          immobilisations={immobilisations}
          cotisations={cotisations}
          lectureIncomplete={lectureIncomplete}
          onClose={() => setPrevisionnelOuvert(false)}
          onSaved={load}
        />
      )}
    </>
  )
}

function DettesRatiosModal({ assujettiTva, modeComptable, piecesValidees, paiements, partsReleve, categories, immobilisations, cotisations, emprunts, lignesDuRythme, deblocagesEcartes, capitalRestantTotal, mensualiteTotale, onClose }: {
  assujettiTva: boolean; modeComptable: ModeComptable; piecesValidees: Piece[]; paiements: LigneBancaire[]; partsReleve: PartDuReleve[]
  categories: Categorie[]; immobilisations: Immobilisation[]; cotisations: CotisationDeclaree[]
  emprunts: Emprunt[]; lignesDuRythme: LigneBanque[]; deblocagesEcartes: number; capitalRestantTotal: number; mensualiteTotale: number; onClose: () => void
}) {
  const aujourdHui = aujourdHuiSql()
  const debutAnnee = `${new Date().getFullYear()}-01-01`
  // Les mois RÉELLEMENT écoulés, et non le numéro du mois courant : c'est le diviseur qui annualise
  // la CAF, et l'étiquette qui l'annonce juste en dessous (voir moisEcoulesDeLAnnee).
  const moisEcoules = moisEcoulesDeLAnnee(aujourdHui)

  const situationAnnee = calculerSituationIntermediaire(piecesValidees, categories, immobilisations, cotisations, debutAnnee, aujourdHui, assujettiTva, paiements, modeComptable, partsReleve)
  // Moyenne sur 6 mois glissants, juste pour disposer d'un rythme d'encaissements de référence — les
  // réglages fins (nombre de mois, projection détaillée) restent dans la modale Plan de trésorerie.
  const plan = calculerPlanTresorerie(lignesDuRythme, 0, 6, 1)
  const ratios = calculerRatiosBancaires(situationAnnee, moisEcoules, capitalRestantTotal, mensualiteTotale, plan.moyenneEncaissements)
  // Le « — » du taux d'endettement ne dit pas POURQUOI : sans cette réserve, « pas encore assez
  // d'historique » et « le rythme est à zéro » se lisent pareil, sur un ratio qu'une banque regarde
  // en premier.
  const reserveMoyenne = reserveSurMoyenne(plan)

  const finPeriode = ajouterMois(aujourdHui, 6)
  const echeances: EcheanceConnue[] = [
    ...echeancesEmprunts(emprunts, aujourdHui, finPeriode),
    ...echeancesCotisations(cotisations, aujourdHui, finPeriode),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const totalCotisationsDues = cotisations
    .filter((c) => c.montant_verse == null)
    .reduce((s, c) => s + c.montant_appele, 0)

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(640px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Dettes & ratios bancaires</h2>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
          <div className="card" style={{ flex: '1 1 170px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Dettes financières (emprunts)</span>
            <strong style={{ fontSize: '1.2rem' }}>{formatMoney(Math.round(capitalRestantTotal * 100) / 100)}</strong>
          </div>
          <div className="card" style={{ flex: '1 1 170px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Cotisations sociales dues</span>
            <strong style={{ fontSize: '1.2rem' }}>{formatMoney(Math.round(totalCotisationsDues * 100) / 100)}</strong>
          </div>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0, marginBottom: 20 }}>
          CAF annuelle estimée (sur {moisEcoules.toFixed(1).replace('.', ',')} mois écoulés cette année,
          ramenée à 12) : <strong>{ratios.cafAnnuelleEstimee === 0 ? '—' : formatMoney(ratios.cafAnnuelleEstimee)}</strong>
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div className="card" style={{ flex: '1 1 220px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Capacité de remboursement</span>
            <strong style={{ fontSize: '1.2rem' }}>
              {ratios.capaciteRemboursementAnnees === null ? '—' : `${ratios.capaciteRemboursementAnnees} an${ratios.capaciteRemboursementAnnees >= 2 ? 's' : ''}`}
            </strong>
            <div className="muted" style={{ fontSize: '0.78rem' }}>Dettes financières / CAF — souvent souhaité ≤ 3-4 ans, seuil variable selon l'établissement.</div>
          </div>
          <div className="card" style={{ flex: '1 1 220px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Taux d'endettement mensuel</span>
            <strong style={{ fontSize: '1.2rem' }}>{ratios.tauxEndettementMensuel === null ? '—' : `${String(ratios.tauxEndettementMensuel).replace('.', ',')} %`}</strong>
            <div className="muted" style={{ fontSize: '0.78rem' }}>
              Mensualités / moyenne des encaissements mensuels des 6 derniers mois complets.
              {deblocagesEcartes > 0 && ' Les fonds reçus d’un emprunt n’y comptent pas : ils ne disent rien de l’activité.'}
              {reserveMoyenne && <span style={{ color: 'var(--color-danger, #c0392b)' }}> {reserveMoyenne}</span>}
            </div>
          </div>
        </div>

        <h3 style={{ marginBottom: 6 }}>Échéances des 6 prochains mois</h3>
        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
          {echeances.length === 0 ? (
            <div className="empty-state">Aucune échéance connue sur la période.</div>
          ) : (
            <table>
              <thead><tr><th>Date</th><th>Libellé</th><th>Montant</th></tr></thead>
              <tbody>
                {echeances.map((e, i) => (
                  <tr key={i}>
                    <td>{formatDate(e.date)}</td>
                    <td>{e.libelle}</td>
                    <td>{formatMoney(e.montant)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

function PlanTresorerieModal({ lignesBanque, lignesDuRythme, deblocagesEcartes, ouverture, soldeActuel, emprunts, cotisations, onClose }: {
  lignesBanque: LigneBanque[]; lignesDuRythme: LigneBanque[]; deblocagesEcartes: number; ouverture: OuvertureBanque | null; soldeActuel: number
  emprunts: Emprunt[]; cotisations: CotisationDeclaree[]; onClose: () => void
}) {
  const [nbMoisHistorique, setNbMoisHistorique] = useState(6)
  const [nbMoisProjection, setNbMoisProjection] = useState(6)

  // Le solde de départ compte tout ; la moyenne, le seul rythme d'activité — sans les déblocages d'emprunt.
  const plan = calculerPlanTresorerie(lignesDuRythme, soldeActuel, nbMoisHistorique, nbMoisProjection)
  // Une projection bâtie sur rien a exactement la même tête qu'une projection bâtie sur six mois.
  const reserve = reserveSurMoyenne(plan)
  // Et le solde de DÉPART vient de la même source, sur une fenêtre plus large : tout l'historique.
  const reserveSolde = reserveSurSolde(lignesBanque, ouverture, aujourdHuiSql())
  // UNE SEULE RÉSERVE À L'ÉCRAN, et l'ordre n'est pas arbitraire : un historique VIDE implique une
  // fenêtre vide, donc les deux se déclenchent ensemble et pour la même cause. Les afficher toutes
  // deux répéterait la même phrase en rouge sous elle-même — et une mise en garde qu'on répète cesse
  // d'être lue. Celle du solde est la plus complète : elle couvre le solde de départ ET la moyenne.
  // Le cas « fenêtre partielle » n'a, lui, aucun équivalent côté solde, donc il reste dit.
  const reserveAffichee = reserveSolde ?? reserve
  const debutProjection = plan.lignes[0]?.mois ? `${plan.lignes[0].mois}-01` : aujourdHuiSql()
  // "-31" plutôt que le vrai dernier jour du mois : comparaison de chaînes (YYYY-MM-DD), pas de
  // date réelle — sert seulement de borne haute, valide même pour un mois de moins de 31 jours.
  const finProjection = plan.lignes.at(-1)?.mois ? `${plan.lignes.at(-1)!.mois}-31` : debutProjection
  const echeances: EcheanceConnue[] = [
    ...echeancesEmprunts(emprunts, debutProjection, finProjection),
    ...echeancesCotisations(cotisations, debutProjection, finProjection),
  ].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(680px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Plan de trésorerie</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tr-historique">Moyenne calculée sur (mois)</label>
            <input id="tr-historique" type="number" min="1" max="24" value={nbMoisHistorique} onChange={(e) => setNbMoisHistorique(Math.max(1, parseInt(e.target.value, 10) || 1))} />
          </div>
          <div className="field">
            <label htmlFor="tr-projection">Projeter sur (mois)</label>
            <input id="tr-projection" type="number" min="1" max="24" value={nbMoisProjection} onChange={(e) => setNbMoisProjection(Math.max(1, parseInt(e.target.value, 10) || 1))} />
          </div>
        </div>
        <p className="muted" style={{ marginTop: -6 }}>
          Moyenne mensuelle observée sur les {nbMoisHistorique} derniers mois complets : {formatMoney(plan.moyenneEncaissements)} d'encaissements,{' '}
          {formatMoney(plan.moyenneDecaissements)} de décaissements — mensualités d'emprunts et cotisations déjà payées comprises, puisqu'elles
          transitent par le même compte banque.
          {deblocagesEcartes > 0 && ' Les fonds reçus d’un emprunt n’entrent pas dans cette moyenne : le solde les compte, mais ils ne disent rien du rythme d’activité.'}
        </p>
        {reserveAffichee && (
          <p className="muted" style={{ marginTop: -4, color: 'var(--color-danger, #c0392b)' }}>{reserveAffichee}</p>
        )}

        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8, marginBottom: 20 }}>
          <table>
            <thead><tr><th>Mois</th><th>Solde début</th><th>Encaissements</th><th>Décaissements</th><th>Solde fin</th></tr></thead>
            <tbody>
              {plan.lignes.map((l) => (
                <tr key={l.mois}>
                  <td>{l.mois}</td>
                  <td>{formatMoney(l.soldeDebut)}</td>
                  <td>{formatMoney(l.encaissements)}</td>
                  <td>{formatMoney(l.decaissements)}</td>
                  <td style={l.soldeFin < 0 ? { color: 'var(--color-danger, #c0392b)', fontWeight: 600 } : undefined}>{formatMoney(l.soldeFin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ marginBottom: 6 }}>Échéances connues sur la période</h3>
        <p className="muted" style={{ marginTop: -4, marginBottom: 10, fontSize: '0.85rem' }}>
          À titre indicatif — déjà comprises dans la moyenne ci-dessus si l'emprunt ou la cotisation
          existe depuis plus de {nbMoisHistorique} mois. Utile surtout pour repérer un emprunt qui se
          termine bientôt ou trop récent pour être dans l'historique.
        </p>
        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
          {echeances.length === 0 ? (
            <div className="empty-state">Aucune échéance connue sur la période.</div>
          ) : (
            <table>
              <thead><tr><th>Date</th><th>Libellé</th><th>Montant</th></tr></thead>
              <tbody>
                {echeances.map((e, i) => (
                  <tr key={i}>
                    <td>{formatDate(e.date)}</td>
                    <td>{e.libelle}</td>
                    <td>{formatMoney(e.montant)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

function SituationIntermediaireModal({ assujettiTva, modeComptable, piecesValidees, paiements, partsReleve, categories, immobilisations, cotisations, lignesBanque, ouverture, onClose }: {
  assujettiTva: boolean; modeComptable: ModeComptable; piecesValidees: Piece[]; paiements: LigneBancaire[]; partsReleve: PartDuReleve[]
  categories: Categorie[]; immobilisations: Immobilisation[]; cotisations: CotisationDeclaree[]
  lignesBanque: LigneBanque[]; ouverture: OuvertureBanque | null; onClose: () => void
}) {
  const [dateFin, setDateFin] = useState(aujourdHuiSql())
  const periodeDebut = `${anneeDe(dateFin)}-01-01`

  const situation = calculerSituationIntermediaire(piecesValidees, categories, immobilisations, cotisations, periodeDebut, dateFin, assujettiTva, paiements, modeComptable, partsReleve)
  const tresorerieADate = soldeBanqueADate(lignesBanque, ouverture, dateFin)
  // « 0,00 € » est juste quand rien n'est comptabilisé, et c'est ce qui le rend dangereux.
  const reserveSolde = reserveSurSolde(lignesBanque, ouverture, dateFin)

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(600px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Situation intermédiaire</h2>
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="situ-date">À la date du</label>
          <input id="situ-date" type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
        </div>
        <p className="muted" style={{ marginTop: -6 }}>
          Période du {formatDate(periodeDebut)} au {formatDate(dateFin)} — uniquement les pièces
          validées dont la catégorie a un poste 2035 renseigné (voir onglet Clôture pour compléter les
          postes manquants). La dotation aux amortissements est rapportée à la période, et un bien
          acquis après cette date n'y figure pas.
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="card" style={{ flex: '1 1 160px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Recettes</span>
            <strong style={{ fontSize: '1.2rem' }}>{formatMoney(situation.recettes)}</strong>
          </div>
          <div className="card" style={{ flex: '1 1 160px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Charges</span>
            <strong style={{ fontSize: '1.2rem' }}>{formatMoney(situation.charges)}</strong>
          </div>
          <div className="card" style={{ flex: '1 1 160px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Résultat intermédiaire</span>
            <strong style={{ fontSize: '1.2rem' }}>{formatMoney(situation.resultat)}</strong>
          </div>
          <div className="card" style={{ flex: '1 1 160px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Trésorerie à cette date</span>
            <strong style={{ fontSize: '1.2rem' }}>{formatMoney(tresorerieADate)}</strong>
          </div>
        </div>
        {reserveSolde && (
          <p className="muted" style={{ marginTop: -6, marginBottom: 16, color: 'var(--color-danger, #c0392b)' }}>{reserveSolde}</p>
        )}

        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
          {situation.totauxParPoste.length === 0 ? (
            <div className="empty-state">Rien à afficher pour cette période.</div>
          ) : (
            <table>
              <thead><tr><th>Poste 2035</th><th>Total</th></tr></thead>
              <tbody>
                {situation.totauxParPoste.map(([poste, total]) => (
                  <tr key={poste}>
                    <td>{poste}</td>
                    <td>{formatMoney(total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

function PrevisionnelModal({ dossierId, assujettiTva, modeComptable, previsionnel, piecesValidees, paiements, partsReleve, categories, immobilisations, cotisations, lectureIncomplete, onClose, onSaved }: {
  dossierId: string; assujettiTva: boolean; modeComptable: ModeComptable; previsionnel: PrevisionnelBancaire | null
  piecesValidees: Piece[]; paiements: LigneBancaire[]; partsReleve: PartDuReleve[]
  categories: Categorie[]; immobilisations: Immobilisation[]; cotisations: CotisationDeclaree[]
  lectureIncomplete: string | null
  onClose: () => void; onSaved: () => void
}) {
  const anneeParDefaut = new Date().getFullYear() - 1
  const [anneeReference, setAnneeReference] = useState(previsionnel?.annee_reference ?? anneeParDefaut)
  const [caReference, setCaReference] = useState(String(previsionnel?.ca_reference ?? 0))
  const [chargesReference, setChargesReference] = useState(String(previsionnel?.charges_reference ?? 0))
  const [tauxCa, setTauxCa] = useState(String(previsionnel?.taux_croissance_ca ?? 0))
  const [tauxCharges, setTauxCharges] = useState(String(previsionnel?.taux_croissance_charges ?? 0))
  const [note, setNote] = useState(previsionnel?.note_hypotheses ?? '')
  const [saving, setSaving] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  // Simple point de départ, jamais enregistré tel quel — réutilise le même calcul que la situation
  // intermédiaire (voir plus haut) sur une année civile complète, pour préremplir CA et charges de
  // référence sans resaisir depuis Clôture. Le cabinet reste libre d'ajuster avant d'enregistrer.
  //
  // Suspendu sur une lecture partielle : le préremplissage n'écrit rien lui-même, mais ce qu'il pose
  // dans le formulaire part tel quel au premier « Enregistrer », sur le document qu'on présente à une
  // banque — et la fenêtre recouvre le bandeau qui dirait que la lecture est incomplète.
  function precharger() {
    if (lectureIncomplete) return
    const situation = calculerSituationIntermediaire(piecesValidees, categories, immobilisations, cotisations, `${anneeReference}-01-01`, `${anneeReference}-12-31`, assujettiTva, paiements, modeComptable, partsReleve)
    setCaReference(String(situation.recettes))
    setChargesReference(String(situation.charges))
  }

  const lignes = calculerPrevisionnel(
    anneeReference, parseFloat(caReference) || 0, parseFloat(chargesReference) || 0,
    parseFloat(tauxCa) || 0, parseFloat(tauxCharges) || 0,
  )

  async function enregistrer() {
    setSaving(true)
    setErreur(null)
    const { error } = await supabase.from('previsionnels_bancaires').upsert({
      dossier_id: dossierId,
      annee_reference: anneeReference,
      ca_reference: parseFloat(caReference) || 0,
      charges_reference: parseFloat(chargesReference) || 0,
      taux_croissance_ca: parseFloat(tauxCa) || 0,
      taux_croissance_charges: parseFloat(tauxCharges) || 0,
      note_hypotheses: note.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'dossier_id' })
    setSaving(false)
    if (error) {
      setErreur(error.message)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(680px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Prévisionnel à 3 ans</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Projection simple par taux de croissance annuel uniforme, à partir d'une année de référence —
          les hypothèses restent celles du cabinet, jamais devinées par l'application.
        </p>

        <div className="field-row">
          <div className="field">
            <label htmlFor="prev-annee">Année de référence</label>
            <input id="prev-annee" type="number" value={anneeReference} onChange={(e) => setAnneeReference(parseInt(e.target.value, 10) || anneeParDefaut)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 14 }}>
            <button type="button" className="btn btn-outline btn-sm" disabled={lectureIncomplete !== null} onClick={precharger}>
              Précharger depuis cette année
            </button>
          </div>
        </div>
        {lectureIncomplete && (
          <p className="error-text" style={{ marginTop: -6 }}>
            Préremplissage suspendu : une lecture est incomplète ({lectureIncomplete}). Le CA et les
            charges seraient calculés sur une partie de l'année — saisis-les à la main, ou recharge la
            page.
          </p>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="prev-ca">CA de référence (€)</label>
            <input id="prev-ca" type="number" step="0.01" value={caReference} onChange={(e) => setCaReference(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="prev-charges">Charges de référence (€)</label>
            <input id="prev-charges" type="number" step="0.01" value={chargesReference} onChange={(e) => setChargesReference(e.target.value)} />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="prev-taux-ca">Croissance CA (%/an)</label>
            <input id="prev-taux-ca" type="number" step="0.1" value={tauxCa} onChange={(e) => setTauxCa(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="prev-taux-charges">Croissance charges (%/an)</label>
            <input id="prev-taux-charges" type="number" step="0.1" value={tauxCharges} onChange={(e) => setTauxCharges(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="prev-note">Note d'hypothèses</label>
          <textarea
            id="prev-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="ex. Croissance portée par l'ouverture d'un nouveau secteur au T2, hausse tarifaire prévue en année 2…"
          />
        </div>

        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8, marginTop: 10, marginBottom: 16 }}>
          <table>
            <thead><tr><th>Année</th><th>CA prévisionnel</th><th>Charges prévisionnelles</th><th>Résultat prévisionnel</th></tr></thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.annee}>
                  <td>{l.annee}</td>
                  <td>{formatMoney(l.ca)}</td>
                  <td>{formatMoney(l.charges)}</td>
                  <td>{formatMoney(l.resultat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {erreur && <p className="error-text">{erreur}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Fermer</button>
          <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer les hypothèses'}
          </button>
        </div>
      </div>
    </div>
  )
}

// `rapprochements` : les mouvements du relevé rapprochés de CET emprunt. Leur découpage est celui que le
// cabinet a validé sur le tableau de la banque, gardé sur le mouvement : modifier l'emprunt ne le change
// pas, seul l'échéancier PROPOSÉ pour les suivantes suit. Une durée plus courte que le numéro d'une
// échéance rapprochée ferait désigner une échéance qui n'existe plus : elle est refusée.
function EmpruntFormModal({ dossierId, emprunt, rapprochements, onClose, onSaved }: {
  dossierId: string; emprunt: Emprunt | null; rapprochements: LigneBancaire[]; onClose: () => void; onSaved: () => void
}) {
  const [nom, setNom] = useState(emprunt?.nom ?? '')
  const [organisme, setOrganisme] = useState(emprunt?.organisme_preteur ?? '')
  const [capital, setCapital] = useState(emprunt ? String(emprunt.capital_initial) : '')
  const [taux, setTaux] = useState(emprunt ? String(emprunt.taux_annuel) : '')
  const [dateDebut, setDateDebut] = useState(emprunt?.date_debut ?? aujourdHuiSql())
  const [dureeMois, setDureeMois] = useState(emprunt ? String(emprunt.duree_mois) : '')
  const [saving, setSaving] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const derniereRapprochee = rapprochements.reduce((m, l) => Math.max(m, l.emprunt_echeance ?? 0), 0)

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    if (parseInt(dureeMois, 10) < derniereRapprochee) {
      setErreur(`L’échéance n° ${derniereRapprochee} de cet emprunt est rapprochée d’un mouvement du relevé : la durée ne peut pas descendre en dessous de ${derniereRapprochee} mois.`)
      return
    }
    setSaving(true)
    setErreur(null)
    const payload = {
      dossier_id: dossierId,
      nom: nom.trim(),
      organisme_preteur: organisme.trim() || null,
      capital_initial: parseFloat(capital),
      taux_annuel: parseFloat(taux),
      date_debut: dateDebut,
      duree_mois: parseInt(dureeMois, 10),
    }
    const { error } = emprunt
      ? await supabase.from('emprunts').update(payload).eq('id', emprunt.id)
      : await supabase.from('emprunts').insert(payload)
    setSaving(false)
    if (error) {
      setErreur(error.message)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(480px, 92vw)' }}>
        <h2 style={{ marginTop: 0 }}>{emprunt ? "Modifier l'emprunt" : 'Nouvel emprunt'}</h2>
        <form onSubmit={enregistrer}>
          <div className="field">
            <label htmlFor="emp-nom">Nom</label>
            <input id="emp-nom" required value={nom} onChange={(e) => setNom(e.target.value)} placeholder="ex. Prêt matériel, Prêt BPI…" />
          </div>
          <div className="field">
            <label htmlFor="emp-organisme">Organisme prêteur (facultatif)</label>
            <input id="emp-organisme" value={organisme} onChange={(e) => setOrganisme(e.target.value)} />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="emp-capital">Capital initial (€)</label>
              <input id="emp-capital" type="number" step="0.01" min="0.01" required value={capital} onChange={(e) => setCapital(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="emp-taux">Taux annuel (%)</label>
              <input id="emp-taux" type="number" step="0.01" min="0" required value={taux} onChange={(e) => setTaux(e.target.value)} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="emp-date">Date de début</label>
              <input id="emp-date" type="date" required value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="emp-duree">Durée (mois)</label>
              <input id="emp-duree" type="number" step="1" min="1" required value={dureeMois} onChange={(e) => setDureeMois(e.target.value)} />
            </div>
          </div>
          <p className="muted" style={{ fontSize: '0.82rem' }}>
            Amortissement à mensualité constante — le calcul le plus courant pour un prêt professionnel.
          </p>
          {rapprochements.length > 0 && (
            <p className="muted" style={{ fontSize: '0.82rem' }}>
              {rapprochements.length} mouvement{rapprochements.length > 1 ? 's' : ''} du relevé {rapprochements.length > 1 ? 'sont rapprochés' : 'est rapproché'} de
              cet emprunt : {rapprochements.length > 1 ? 'leur découpage validé ne change' : 'son découpage validé ne change'} pas si tu le modifies, seul
              l’échéancier proposé pour les échéances suivantes suit.
            </p>
          )}
          {erreur && <p className="error-text">{erreur}</p>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// `rapprochements` : les mouvements du relevé rapprochés de cet emprunt. Une échéance rapprochée dit le
// jour où elle a été payée ; c'est son découpage VALIDÉ, gardé sur le mouvement, que la 2035 compte — pas
// celui de ce tableau, qui n'est qu'une proposition.
function EcheancierModal({ emprunt, rapprochements, onClose }: { emprunt: Emprunt; rapprochements: LigneBancaire[]; onClose: () => void }) {
  const lignes = genererEcheancier(emprunt)
  const payees = echeancesOccupees(rapprochements, emprunt.id, null)
  const deblocage = rapprochements.find((l) => l.montant > 0) ?? null
  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(640px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Échéancier — {emprunt.nom}</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          {formatMoney(emprunt.capital_initial)} sur {emprunt.duree_mois} mois à {String(emprunt.taux_annuel).replace('.', ',')} %,
          à partir du {formatDate(emprunt.date_debut)}.
          {deblocage && ` Fonds reçus le ${formatDate(deblocage.date)}.`}
          {' '}{payees.size === 0
            ? 'Aucune échéance n’est encore rapprochée d’un mouvement du relevé (Banque) : leurs intérêts ne comptent pas dans la 2035.'
            : `${payees.size} échéance${payees.size > 1 ? 's' : ''} rapprochée${payees.size > 1 ? 's' : ''} d’un mouvement du relevé : la 2035 en compte le découpage validé, qui peut différer de ce tableau.`}
        </p>
        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
          <table>
            <thead><tr><th>#</th><th>Date</th><th>Mensualité</th><th>Intérêts</th><th>Capital remboursé</th><th>Restant dû</th><th>Payée le</th></tr></thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.numero}>
                  <td>{l.numero}</td>
                  <td>{formatDate(l.date)}</td>
                  <td>{formatMoney(l.mensualite)}</td>
                  <td>{formatMoney(l.interets)}</td>
                  <td>{formatMoney(l.capitalRembourse)}</td>
                  <td>{formatMoney(l.capitalRestant)}</td>
                  <td>{payees.has(l.numero) ? formatDate(payees.get(l.numero)!) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
