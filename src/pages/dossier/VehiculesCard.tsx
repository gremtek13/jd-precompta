import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { lireTout } from '../../lib/lectureComplete'
import { anneeDe, aujourdHuiSql, formatMoney } from '../../lib/format'
import {
  carburantApplicable, completerModificationVehicule, exercicesProposables,
  totalIndemnitesKilometriques, vehiculeDuDossier,
} from '../../lib/baremeKilometrique'
import type { TypeVehicule } from '../../lib/baremeKilometrique'
import type { ModeleComptable } from '../../lib/engagement'
import {
  dateDuForfait, forfaitsDuCadre7, forfaitsEnDefaut, nomDuVehicule, type EtatForfait, type ForfaitDuVehicule,
} from '../../lib/forfaitKilometrique'
import { compteDuDirigeant } from '../../lib/virementPersonnel'
import { messageErreur } from '../../lib/messageErreur'
import type { ANouveau, EcritureBrouillon, VehiculeDossier } from '../../lib/types'
import { useAnnee } from '../../context/AnneeContext'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'

// Cadre 7 du 2035-B, « Barèmes kilométriques ». Sans ces lignes, la case BJ du 2035-A (ligne 23,
// frais de véhicules) reste vide alors que le bas du 2035-B dit « Total A à reporter ligne 23 de
// l'annexe 2035 A ».
//
// Le kilométrage est par EXERCICE, pas par véhicule : l'option pour le forfait se prend au 1er
// janvier et vaut pour l'année entière (notice 2035-NOT-SD, renvoi 12). Un même véhicule a donc une
// ligne par année, et l'écran suit l'exercice choisi en en-tête du dossier.
//
// Quand l'en-tête est sur « toutes années », l'écran ne saisit RIEN et propose de choisir. Il
// retombait auparavant sur l'année civile en cours : des kilomètres partaient alors sur un exercice
// que personne n'avait demandé, et l'indemnité revenait en « barème non renseigné » sans que le lien
// avec l'année soit visible. C'est le cas qui a fait perdre du temps en production.
//
// LE FORFAIT S'ÉCRIT DEPUIS CETTE CARTE (ligne 26.6, étape b — lib/forfaitKilometrique.ts) : chaque ligne du
// cadre 7 est comparée au brouillon, et « Écrire les N » écrit son forfait par la fonction de la base, qui
// refait le calcul du barème et refuse une écriture qui ne vaut pas son indemnité au centime. Le retrait d'un
// véhicule passe par la base aussi, qui emporte son forfait.

const TYPES: { valeur: TypeVehicule; libelle: string }[] = [
  { valeur: 'voiture', libelle: 'Voiture (tourisme)' },
  { valeur: 'moto', libelle: 'Moto (> 50 cm³)' },
  { valeur: 'cyclomoteur', libelle: 'Cyclomoteur (< 50 cm³)' },
]

const MOTORISATIONS = ['thermique', 'hydrogene', 'hybride', 'electrique'] as const
const CARBURANTS = ['diesel', 'super_sans_plomb', 'gpl'] as const

const LIBELLE_MOTORISATION: Record<(typeof MOTORISATIONS)[number], string> = {
  thermique: 'Thermique', hydrogene: 'À hydrogène', hybride: 'Hybride', electrique: 'Électrique',
}
const LIBELLE_CARBURANT: Record<(typeof CARBURANTS)[number], string> = {
  diesel: 'Diesel', super_sans_plomb: 'Super sans plomb', gpl: 'GPL',
}

const LIBELLE_ETAT: Record<EtatForfait, string> = {
  a_ecrire: 'À écrire',
  a_reecrire: 'À réécrire',
  a_retirer: 'À retirer',
  ecrit: 'Écrit',
  valide: 'Validé, ne suit plus le cadre 7',
  rien: 'Rien à écrire',
}

// Ce que la Checklist réclame, dit dans la carte — accordé, la phrase se lisant d'un coup d'œil.
function phraseEnDefaut(n: number): string {
  return n === 1
    ? '1 forfait manque à un exercice fini ou ne suit plus le cadre 7 : la Checklist le réclame.'
    : `${n} forfaits manquent à un exercice fini ou ne suivent plus le cadre 7 : la Checklist les réclame.`
}

// Le kilométrage tel que le champ le donne : un nombre entier de kilomètres, la colonne étant entière en base.
// « 12,5 » ou un champ vidé valent ce qu'on peut en garder sans deviner — la partie entière, ou zéro.
function kilometrageSaisi(texte: string): number {
  const km = Math.trunc(Number(texte.replace(',', '.')))
  return Number.isFinite(km) && km > 0 ? km : 0
}

export default function VehiculesCard({ dossierId, modele }: { dossierId: string; modele: ModeleComptable }) {
  const { annee, setAnnee } = useAnnee()
  const [vehicules, setVehicules] = useState<VehiculeDossier[]>([])
  const [ecrituresForfaits, setEcrituresForfaits] = useState<EcritureBrouillon[]>([])
  const [ouverture, setOuverture] = useState<string | null>(null)
  // Deux drapeaux, deux conséquences : une liste de véhicules lue en partie fausse le TOTAL de la ligne 23 ;
  // une lecture partielle des véhicules, de leurs forfaits écrits ou de l'ouverture fausse l'ÉTAT des forfaits,
  // et un bouton à côté écrit — leur écriture se suspend (CLAUDE.md, « une lecture partielle ne commande pas
  // d'écriture »).
  const [vehiculesIncomplets, setVehiculesIncomplets] = useState<string | null>(null)
  const [forfaitsIncomplets, setForfaitsIncomplets] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)
  // UN verrou pour les gestes qui écrivent un forfait ou ce dont il dépend : « Écrire les N », « Retirer » et
  // la modification d'une ligne. Modifié ou retiré pendant le lot, un véhicule verrait son forfait écrit
  // d'après ce que le lot a lu avant. Un `useRef`, posé avant le premier `await` et relâché dans un `finally`,
  // APRÈS la relecture (voir CLAUDE.md, « un verrou d'exécution »).
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)

  // Null quand l'en-tête est sur « toutes années » : un kilométrage se rattache forcément à un
  // exercice précis, et la carte n'en choisit PAS un à la place de l'utilisateur. Elle retombait
  // auparavant sur l'année civile en cours — elle enregistrait alors des kilomètres sur un exercice
  // que personne n'avait demandé, et l'indemnité repartait en « barème non renseigné » sans que le
  // lien avec l'année saute aux yeux.
  const exercice = typeof annee === 'number' ? annee : null

  // Tous les exercices du dossier en une requête, filtrés ensuite en mémoire : quelques véhicules par
  // dossier, et cela donne gratuitement la liste des exercices déjà pourvus, qu'il faut de toute
  // façon proposer — et les forfaits de TOUS les exercices, que la carte écrit d'un coup.
  //
  // `chargement` ne repasse pas à vrai au rechargement : après une écriture, la carte garde ce qu'elle montrait
  // — boutons grisés sous le verrou — jusqu'à ce que la relecture revienne, au lieu de se vider.
  async function charger() {
    const [lectureVehicules, lectureEcritures, lectureOuverture] = await Promise.all([
      // Tri TOTAL : ni `annee` ni `created_at` ne sont uniques, donc `id` départage.
      lireTout<VehiculeDossier>((debut, fin) =>
        supabase.from('vehicules').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('annee', { ascending: false }).order('created_at').order('id').range(debut, fin),
      ),
      // Les forfaits ÉCRITS au brouillon : ceux qu'on compare au cadre 7.
      lireTout<EcritureBrouillon>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).not('vehicule_id', 'is', null).order('date').order('id').range(debut, fin),
      ),
      // L'ouverture du dossier : avant elle, l'exercice est dans les comptes repris, et son forfait avec lui.
      lireTout<Pick<ANouveau, 'id' | 'date'>>((debut, fin) =>
        supabase.from('a_nouveaux').select('id, date', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin),
      ),
    ])
    setVehicules(lectureVehicules.lignes)
    setEcrituresForfaits(lectureEcritures.lignes)
    setOuverture(lectureOuverture.lignes[0]?.date ?? null)
    setVehiculesIncomplets(lectureVehicules.complete ? null : lectureVehicules.motif)
    setForfaitsIncomplets([lectureVehicules, lectureEcritures, lectureOuverture].find((l) => !l.complete)?.motif ?? null)
    setChargement(false)
  }

  useEffect(() => { charger() }, [dossierId])

  // L'exercice en cours, lu à chaque rendu : une carte laissée ouverte au passage d'une année doit passer à la
  // nouvelle (voir CLAUDE.md, « maintenant lu au chargement d'un module est figé »).
  const anneeCourante = anneeDe(aujourdHuiSql())
  const vehiculesDeLExercice = vehicules.filter((v) => v.annee === exercice)
  const anneesAvecVehicules = [...new Set(vehicules.map((v) => v.annee))]
  const exercicesAuChoix = exercicesProposables(anneesAvecVehicules)
  const nbVehiculesDe = (a: number) => vehicules.filter((v) => v.annee === a).length

  // LES FORFAITS DU CADRE 7, sur TOUS les exercices — jamais sur celui que l'en-tête laisse voir : un forfait à
  // écrire ne disparaît pas parce qu'on regarde une autre année.
  const forfaits = forfaitsDuCadre7(vehicules, ecrituresForfaits, modele, ouverture, anneeCourante)
  const forfaitDe = (id: string) => forfaits.find((f) => f.vehicule.id === id)
  const aTraiter = forfaits.filter((f) => f.etat !== 'ecrit' && f.etat !== 'rien')
  const aEcrire = aTraiter.filter((f) => f.etat !== 'valide' && !f.refus)
  const enDefaut = forfaitsEnDefaut(forfaits, anneeCourante)
  const ecritureSuspendue = forfaitsIncomplets !== null

  // Verrou posé avant tout `await` : un double clic créerait deux véhicules vides.
  const ajoutEnCours = useRef(false)

  async function ajouter() {
    if (exercice === null || ajoutEnCours.current) return
    ajoutEnCours.current = true
    try {
      const { error } = await supabase.from('vehicules').insert({ dossier_id: dossierId, annee: exercice })
      if (error) { setErreur(messageErreur(error, 'Le véhicule n’a pas pu être ajouté.')); return }
      setErreur(null)
      await charger()
    } finally {
      ajoutEnCours.current = false
    }
  }

  // Écriture immédiate sur changement de champ : une modale de plus pour six champs ferait perdre
  // plus de temps qu'elle n'en fait gagner. L'échec est dit, jamais avalé. Une modification n'écrit que la
  // ligne : son forfait, s'il est écrit, paraît alors « à réécrire », et c'est « Écrire les N » qui le remplace.
  async function modifier(id: string, demande: Partial<VehiculeDossier>) {
    if (ecritureEnCours.current) return
    // Passe systématiquement par la règle de cohérence : un champ devenu sans objet est remis à zéro
    // dans la MÊME écriture (voir completerModificationVehicule). Le faire ici plutôt qu'au cas par cas
    // dans chaque `onChange` garantit qu'aucun champ ajouté plus tard n'y échappera par oubli.
    const champs = completerModificationVehicule(demande)
    setVehicules((v) => v.map((x) => (x.id === id ? { ...x, ...champs } : x)))
    const { error } = await supabase.from('vehicules').update(champs).eq('id', id)
    if (error) { setErreur(messageErreur(error, 'Le véhicule n’a pas pu être modifié.')); charger() } else setErreur(null)
  }

  // PAR LA BASE, PLUS PAR UNE SUPPRESSION DIRECTE : la clé d'un forfait vers son véhicule est sans action, et
  // `retirer_vehicule` retire la ligne ET son forfait écrit en une transaction — elle refuse si le forfait est
  // validé.
  async function retirer(v: VehiculeDossier) {
    if (ecritureEnCours.current) return
    const sonForfait = ecrituresForfaits.filter((e) => e.vehicule_id === v.id)
    if (sonForfait.some((e) => e.statut !== 'proposee')) {
      setErreur('Le forfait de ce véhicule est validé : il ne se retire plus.')
      return
    }
    // Le bouton « Retirer » vit dans la MÊME ligne que le champ des kilomètres qu'on vient
    // d'éditer : un clic distrait effaçait le véhicule, sa puissance fiscale et son kilométrage,
    // tous saisis à la main, et rien ne le demandait. Ces kilomètres décident de la case BJ de la
    // 2035 — la déduction disparaît alors sans que personne ne la cherche.
    // Le message NOMME ce qui part, comme partout ailleurs dans ce projet : « Êtes-vous sûr ? » ne
    // dit pas ce qu'on perd, et se ferme en un clic aussi distrait que le premier.
    // Le modèle est facultatif : sans lui, on nomme le véhicule par ce que le barème en sait.
    const montantEcrit = sonForfait.filter((e) => e.sens === 'debit').reduce((s, e) => s + e.montant, 0)
    // Sur une lecture partielle des forfaits, on ne sait pas s'il en est un : on le dit plutôt que de se taire.
    const forfaitQuiPart = forfaitsIncomplets
      ? ' Son forfait écrit au brouillon, s’il en est un, part avec lui — la liste des forfaits n’a pas pu être lue en entier.'
      : sonForfait.length > 0
        ? ` Son forfait écrit au brouillon (${formatMoney(montantEcrit)}) part avec lui.`
        : ''
    if (!window.confirm(
      `Retirer « ${nomDuVehicule(v)} » de l'exercice ${v.annee} ? Ses ${v.km_professionnel} km professionnels `
      + 'seront perdus, et l\'indemnité kilométrique de cet exercice recalculée sans lui.' + forfaitQuiPart,
    )) return
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const { error } = await supabase.rpc('retirer_vehicule', { p_vehicule_id: v.id })
      setErreur(error ? `Le véhicule n’a pas pu être retiré : ${messageErreur(error, 'raison inconnue')}` : null)
      await charger()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  // Chaque forfait par la fonction de la base, un à un : elle refait le calcul du barème, vérifie l'écriture et
  // remplace celle qui ne correspond plus — un forfait à retirer part avec une écriture vide. Un échec
  // n'interrompt pas le lot, et se dit. Le verrou se relâche APRÈS la relecture : relâché avant, la carte
  // montrerait encore « Écrire les N » sur des forfaits déjà écrits, le temps qu'elle revienne.
  async function ecrireLesForfaits() {
    if (ecritureEnCours.current || ecritureSuspendue || aEcrire.length === 0) return
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const echecs: string[] = []
      for (const f of aEcrire) {
        const { error } = await supabase.rpc('ecrire_forfait_kilometrique', {
          p_vehicule_id: f.vehicule.id,
          p_ecritures: f.attendues ?? [],
        })
        if (error) echecs.push(`${nomDuVehicule(f.vehicule)} (${f.vehicule.annee}) : ${messageErreur(error, 'raison inconnue')}`)
      }
      setErreur(echecs.length > 0
        ? `Forfaits écrits : ${aEcrire.length - echecs.length} sur ${aEcrire.length}. `
          + `Refusé${echecs.length > 1 ? 's' : ''} par la base : ${echecs.join(' ; ')}`
        : null)
      await charger()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  // Ce que dit la colonne « Forfait » d'une ligne : l'état de son écriture, ou pourquoi il n'y en a pas.
  function etatDuForfait(f: ForfaitDuVehicule | undefined): { texte: string; refus: string | null } {
    if (!f) return { texte: '—', refus: null }
    if (f.etat === 'rien' && ouverture && dateDuForfait(f.vehicule.annee) < ouverture) return { texte: 'Dans les à-nouveaux', refus: null }
    return { texte: LIBELLE_ETAT[f.etat], refus: f.etat === 'ecrit' || f.etat === 'rien' ? null : f.refus }
  }

  const { total, nonCalcules } = exercice === null
    ? { total: 0, nonCalcules: [] }
    : totalIndemnitesKilometriques(vehiculesDeLExercice.map(vehiculeDuDossier), exercice)
  const baremeManquant = nonCalcules.some((n) => n.motif === 'barème non renseigné pour cet exercice')

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>
        Véhicules et barème kilométrique{exercice !== null && ` — exercice ${exercice}`}
      </h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Cadre 7 du 2035-B. Le total des indemnités se reporte ligne 23 du 2035-A (case BJ, frais de
        véhicules). Le kilométrage est propre à chaque exercice : l'option pour le forfait se prend
        au 1<sup>er</sup> janvier et vaut pour l'année entière. Le forfait de chaque véhicule s'écrit au
        brouillon au 31 décembre : les indemnités au compte 625110, face au compte du dirigeant
        ({compteDuDirigeant(modele)}) — c'est lui qui a supporté les frais du véhicule.
      </p>

      <BandeauLecturePartielle
        quoi="Les véhicules du dossier"
        accord="lus"
        motif={vehiculesIncomplets}
        consequence="Le total de la ligne 23 ci-dessous peut donc être faux : un véhicule non lu n’y est pas compté."
      />
      <BandeauLecturePartielle
        quoi="Les véhicules, leurs forfaits écrits au brouillon ou l’ouverture du dossier"
        accord="lus"
        motif={forfaitsIncomplets}
        consequence={
          'L’état des forfaits ci-dessous peut être faux — un forfait écrit peut y paraître à écrire — : '
          + 'leur écriture est suspendue jusqu’au rechargement de la page.'
        }
      />

      {erreur && <p className="error-text">{erreur}</p>}

      {chargement ? (
        <p className="muted">Chargement…</p>
      ) : exercice === null ? (
        /* L'en-tête du dossier est sur « toutes années ». La carte ne choisit PAS un exercice à la
           place de l'utilisateur : des kilomètres enregistrés sur une année que personne n'a
           demandée sont une donnée fausse, et le calcul qui échoue derrière ne dit pas pourquoi.
           Les exercices sont proposés ici même plutôt que par un renvoi vers l'en-tête — le choix se
           fait là où la question se pose. */
        <div style={{ padding: '4px 0 8px' }}>
          <p style={{ marginTop: 0 }}>
            Choisis l'exercice à renseigner : un kilométrage se rattache à une année précise, et
            l'option pour le forfait vaut pour l'année entière.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {exercicesAuChoix.map((a) => (
              <button key={a} className="btn btn-outline btn-sm" onClick={() => setAnnee(a)}>
                {a}
                {nbVehiculesDe(a) > 0 && (
                  <span className="muted" style={{ marginLeft: 6 }}>
                    · {nbVehiculesDe(a)} véhicule{nbVehiculesDe(a) > 1 ? 's' : ''}
                  </span>
                )}
              </button>
            ))}
          </div>
          {anneesAvecVehicules.length === 0 && (
            <p className="muted" style={{ marginBottom: 0, marginTop: 10, fontSize: '0.85rem' }}>
              Aucun véhicule déclaré sur ce dossier, quel que soit l'exercice.
            </p>
          )}
        </div>
      ) : vehiculesDeLExercice.length === 0 ? (
        <div className="empty-state" style={{ padding: 16 }}>
          Aucun véhicule déclaré sur l'exercice {exercice}.
          {anneesAvecVehicules.length > 0 && (
            /* Dit où sont les véhicules plutôt que de laisser croire que le dossier n'en a aucun :
               c'est exactement la confusion qui fait ressaisir des kilomètres déjà enregistrés. */
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <span className="muted">Déjà renseignés sur :</span>
              {anneesAvecVehicules.map((a) => (
                <button key={a} className="btn btn-outline btn-sm" onClick={() => setAnnee(a)}>
                  {a} · {nbVehiculesDe(a)}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="table-scroll formulaire-adaptable">
          {/* `table-formulaire` : une ligne de ce tableau est un FORMULAIRE, pas une donnée à lire.
              Dans une carte étroite — téléphone, 1 024 pixels, volet ouvert —, elle se replie en fiche
              empilée libellé/champ plutôt que de se comprimer ; `formulaire-adaptable` est l'enveloppe
              dont la largeur en décide — voir index.css. */}
          <table className="table-formulaire">
            <thead>
              <tr>
                <th>Modèle</th>
                <th>Type</th>
                <th style={{ width: 90 }}>Puiss. fisc.</th>
                <th>Motorisation</th>
                <th>Carburant</th>
                <th style={{ width: 120 }}>Km pro</th>
                <th style={{ textAlign: 'right' }}>Indemnité</th>
                <th>Forfait</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vehiculesDeLExercice.map((v) => {
                const indemnite = totalIndemnitesKilometriques([vehiculeDuDossier(v)], exercice)
                const etat = etatDuForfait(forfaitDe(v.id))
                return (
                  <tr key={v.id}>
                    <td data-libelle="Modèle">
                      <input
                        value={v.modele ?? ''}
                        placeholder="ex. Peugeot 308"
                        disabled={enCours}
                        onChange={(e) => modifier(v.id, { modele: e.target.value || null })}
                      />
                    </td>
                    <td data-libelle="Type">
                      <select value={v.type} disabled={enCours} onChange={(e) => modifier(v.id, { type: e.target.value as TypeVehicule })}>
                        {TYPES.map((t) => <option key={t.valeur} value={t.valeur}>{t.libelle}</option>)}
                      </select>
                    </td>
                    <td data-libelle="Puiss. fisc.">
                      <input
                        type="number" min={0} max={99}
                        value={v.puissance_fiscale}
                        // Le cyclomoteur n'a pas de puissance fiscale au sens du barème.
                        disabled={enCours || v.type === 'cyclomoteur'}
                        onChange={(e) => modifier(v.id, { puissance_fiscale: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td data-libelle="Motorisation">
                      <select
                        value={v.motorisation ?? ''}
                        disabled={enCours}
                        onChange={(e) => modifier(v.id, { motorisation: (e.target.value || null) as VehiculeDossier['motorisation'] })}
                      >
                        <option value="">—</option>
                        {MOTORISATIONS.map((m) => <option key={m} value={m}>{LIBELLE_MOTORISATION[m]}</option>)}
                      </select>
                    </td>
                    <td data-libelle="Carburant">
                      <select
                        value={v.carburant ?? ''}
                        // Un véhicule électrique ou à hydrogène ne consomme aucun des carburants du
                        // formulaire : le champ est grisé plutôt que masqué, parce que la colonne
                        // existe sur le 2035-B et qu'une colonne absente passerait pour un oubli.
                        disabled={enCours || !carburantApplicable(v.motorisation)}
                        title={carburantApplicable(v.motorisation) ? undefined : 'Sans objet pour cette motorisation'}
                        onChange={(e) => modifier(v.id, { carburant: (e.target.value || null) as VehiculeDossier['carburant'] })}
                      >
                        <option value="">{carburantApplicable(v.motorisation) ? '—' : 'Sans objet'}</option>
                        {CARBURANTS.map((c) => <option key={c} value={c}>{LIBELLE_CARBURANT[c]}</option>)}
                      </select>
                    </td>
                    <td data-libelle="Km pro">
                      <input
                        type="number" min={0} step={1}
                        value={v.km_professionnel}
                        disabled={enCours}
                        // Un nombre ENTIER de kilomètres : la colonne l'est en base, et « 12,5 » y serait refusé.
                        onChange={(e) => modifier(v.id, { km_professionnel: kilometrageSaisi(e.target.value) })}
                      />
                    </td>
                    <td data-libelle="Indemnité" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {indemnite.nonCalcules.length > 0
                        ? <span className="muted" title={indemnite.nonCalcules[0].motif}>—</span>
                        : formatMoney(indemnite.total)}
                    </td>
                    <td data-libelle="Forfait">
                      {/* D'un seul tenant : « À réécrire » se coupait en deux lignes dans la colonne étroite. */}
                      <span style={{ whiteSpace: 'nowrap' }}>{etat.texte}</span>
                      {etat.refus && <div className="muted" style={{ fontSize: '0.85em' }}>{etat.refus}</div>}
                    </td>
                    <td className="td-action">
                      <button className="btn btn-outline btn-sm" disabled={enCours} onClick={() => retirer(v)}>Retirer</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>
                  Total à reporter ligne 23 (case BJ)
                </td>
                <td data-libelle="Total ligne 23 (case BJ)" style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {baremeManquant ? '—' : formatMoney(total)}
                </td>
                <td></td>
                <td className="td-action"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {baremeManquant && (
        // Dit franchement pourquoi rien n'est calculé, plutôt que d'afficher un zéro qui passerait
        // pour un montant. Un barème kilométrique est publié chaque année par l'administration ;
        // appliquer celui d'une autre année produirait une déduction fausse.
        <p style={{ color: 'var(--color-warning)', marginBottom: 0 }}>
          ⚠ Le barème kilométrique {exercice} n'est pas encore renseigné dans l'application : les
          kilomètres sont bien enregistrés, mais l'indemnité ne peut pas être calculée. Rien n'est
          reporté ligne 23 tant que le barème officiel n'a pas été saisi.
        </p>
      )}

      {/* Rien à ajouter tant qu'aucun exercice n'est choisi : le véhicule serait rattaché à une année
          devinée. Le bouton disparaît plutôt que d'être grisé — grisé, il laisserait chercher ce qui
          le débloque, alors que la réponse est juste au-dessus. */}
      {exercice !== null && (
        <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={ajouter}>
          + Ajouter un véhicule sur {exercice}
        </button>
      )}

      {/* Les forfaits de TOUS les exercices, et pas seulement celui de l'en-tête : la carte les écrit d'un coup,
          et un forfait à écrire ne se cache pas derrière une autre année. */}
      {!chargement && aTraiter.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <h4 style={{ margin: 0 }}>Forfaits kilométriques à écrire ({aTraiter.length})</h4>
            {aEcrire.length > 0 && (
              <button className="btn btn-primary btn-sm" disabled={enCours || ecritureSuspendue} onClick={ecrireLesForfaits}>
                {enCours ? 'Écriture…' : aEcrire.length === 1 ? 'Écrire ce forfait' : `Écrire les ${aEcrire.length}`}
              </button>
            )}
          </div>
          <p className="muted">
            Chaque forfait s’écrit au 31 décembre de son exercice, sur le kilométrage du cadre 7 : le FEC le porte au
            journal des opérations diverses, le barème pour pièce. Celui de l’exercice en cours peut s’écrire dès
            aujourd’hui sur le kilométrage saisi ; la Checklist ne le réclame qu’une fois l’exercice fini.
          </p>
          {enDefaut.length > 0 && <p><strong>{phraseEnDefaut(enDefaut.length)}</strong></p>}
          {ecritureSuspendue && (
            <p className="error-text">Écriture suspendue : une lecture est partielle (voir plus haut). Rechargez la page.</p>
          )}
          <div className="table-scroll">
            <table aria-label="Forfaits à écrire">
              <thead>
                <tr>
                  <th>Véhicule</th>
                  <th>Exercice</th>
                  <th style={{ textAlign: 'right' }}>Forfait</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {aTraiter.map((f) => (
                  <tr key={f.vehicule.id}>
                    <td>{nomDuVehicule(f.vehicule)}</td>
                    <td>{f.vehicule.annee}{f.vehicule.annee === anneeCourante ? ' (en cours)' : ''}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {f.centimes === null ? '—' : formatMoney(Number(f.centimes) / 100)}
                    </td>
                    <td>
                      <span style={{ whiteSpace: 'nowrap' }}>{LIBELLE_ETAT[f.etat]}</span>
                      {f.refus && <div className="muted" style={{ fontSize: '0.85em' }}>{f.refus}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
