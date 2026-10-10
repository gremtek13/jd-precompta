import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import EnvoyerEmailModal from '../../components/EnvoyerEmailModal'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { extraireErreurFonction } from '../../lib/invokeErreur'
import { messageErreur } from '../../lib/messageErreur'
import { lireTout } from '../../lib/lectureComplete'
import {
  CE_QUE_DISENT_LES_CASES, CE_QUE_DONNE_UN_ACCES, DOMAINES, changementApplique, demandeDeChangement, droitsDeLaLigne,
  libelleDeLaCase, messageDuRefus, type Domaine,
} from '../../lib/droitsAcces'
import type { Membership } from '../../lib/types'

// Un accès tel que l'onglet le lit : la personne, et ses deux droits (espace client, étape P1, voir lib/droitsAcces.ts).
type AccesLu = Pick<Membership, 'id' | 'user_id' | 'email' | 'droit_ventes' | 'droit_banque'>

// Domaine dédié à la réception (Resend) — distinct du domaine principal pour ne pas toucher à la
// messagerie personnelle existante. Voir Palier 4 : le client configure un simple transfert
// automatique de ses e-mails de prélèvement vers cette adresse, sans jamais donner accès à sa boîte.
const DOMAINE_COLLECTE_EMAIL = 'precompta.jdarnis.fr'

export default function AccesTab({ dossierId, dossierNom, codeEmail }: { dossierId: string; dossierNom: string; codeEmail: string | null }) {
  const [rows, setRows] = useState<AccesLu[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [copie, setCopie] = useState(false)
  const [copieRefusee, setCopieRefusee] = useState(false)
  // Le « Copié ✓ » s'efface au bout de deux secondes. Son minuteur part avec l'écran : laissé derrière lui, il rappelait
  // un écran démonté, et dans la suite de tests un environnement déjà détruit (une erreur non gérée, au hasard de la
  // charge). `demonte` couvre la copie encore en vol au démontage, qui armerait sinon un minuteur que plus rien n'annule.
  const minuteurCopie = useRef<ReturnType<typeof setTimeout> | null>(null)
  const demonte = useRef(false)
  useEffect(() => {
    demonte.current = false
    return () => {
      demonte.current = true
      if (minuteurCopie.current !== null) clearTimeout(minuteurCopie.current)
    }
  }, [])
  const [relanceDe, setRelanceDe] = useState<AccesLu | null>(null)
  // « Aucun accès client pour ce dossier » est une AFFIRMATION, pas un écran vide : une lecture
  // refusée rendait la même liste vide, et le cabinet en concluait qu'il ne restait aucun accès.
  // C'est le pire sens pour ce geste-là — on coupe l'accès d'un client qui part, et on croit l'avoir
  // fait. Même famille que la suppression d'un dossier : une lecture dont l'échec ressemble à un
  // résultat vide se vérifie comme une écriture.
  const [erreurLecture, setErreurLecture] = useState<string | null>(null)
  // La liste lue en partie (des accès revenus, d'autres non) : elle se montre, avec sa raison, mais n'offre AUCUNE case —
  // un droit ne se change pas depuis une liste dont on sait qu'elle est incomplète.
  const [lecturePartielle, setLecturePartielle] = useState<string | null>(null)
  // Vrai tant que la PREMIÈRE lecture n'est pas revenue : avant elle, la liste est vide faute d'avoir été lue, et l'écran
  // disait « Aucun accès client pour ce dossier. » au premier rendu, y compris pour un dossier qui en a un. Il ne vaut que
  // pour la première lecture : `load()` repart après une création ou un retrait, et la liste déjà lue reste sous les yeux
  // jusqu'à la relecture. Un autre dossier remonte l'onglet (`AnneeProvider key`), donc repart à vrai.
  const [chargement, setChargement] = useState(true)
  // Une RELECTURE en vol : la liste reste sous les yeux, mais ses cases attendent qu'elle revienne, et l'écran le dit.
  const [relecture, setRelecture] = useState(false)
  // Le numéro de la dernière lecture partie : une lecture plus lente qu'une suivante (une création puis un retrait
  // rapprochés) ne réécrit pas la liste après elle.
  const derniereLecture = useRef(0)

  // Verrou d'exécution en `useRef`, pas en état React : `setInviting(true)` ne prend effet qu'au
  // rendu suivant, donc `disabled={inviting}` laisse passer deux soumissions rapprochées — sur un
  // FORMULAIRE le déclencheur n'est même pas le double clic mais deux « Entrée » (CLAUDE.md, motif
  // déjà vu sur EnvoyerEmailModal, FactureAvoirModal et consorts). Posé AVANT le `try` : dedans, le
  // `return` du deuxième clic sortirait par le `finally`, qui relâcherait le verrou du PREMIER,
  // encore en cours.
  //
  // Le doublon ne crée pas qu'une ligne en trop : create-client-access appelle
  // `auth.admin.createUser` deux fois pour la même adresse, une course entre les deux appels que la
  // fonction ne peut pas fermer elle-même (elle ne voit rien de la seconde requête pendant que la
  // première est en vol) — au mieux un message d'erreur incompréhensible pour un accès qui vient
  // pourtant d'être créé, au pire deux appels admin facturés pour rien.
  const creationEnCours = useRef(false)

  // Le verrou des cases, en `useRef` comme celui de la création, posé avant le `try`. C'est la SECONDE barrière : une case
  // est une entrée contrôlée, React rend donc toutes les cases grisées avant la fin de l'événement qui en coche une, et un
  // second clic n'atteint pas `changerDroit`. Le verrou tient le jour où une case resterait libre pendant l'écriture — deux
  // écritures partiraient, la seconde calculée sur la liste d'avant la première. Relâché APRÈS la relecture : la case
  // montre alors ce que la base a gardé, et le clic suivant part de cet état-là.
  const ecritureDroitsEnCours = useRef(false)
  // La case cliquée, le temps de son écriture : elle montre la valeur demandée, et toutes les cases attendent.
  const [droitEnCours, setDroitEnCours] = useState<{ id: string; domaine: Domaine; valeur: boolean } | null>(null)
  const [erreurDroits, setErreurDroits] = useState<string | null>(null)

  async function load() {
    const numero = ++derniereLecture.current
    setRelecture(true)
    // Par `lireTout`, qui dit si la liste est COMPLÈTE : une poignée de personnes aujourd'hui, mais ses cases écrivent
    // depuis elle, et « Aucun accès » est une affirmation.
    const lecture = await lireTout<AccesLu>((debut, fin) => supabase
      .from('memberships')
      .select('id, user_id, email, droit_ventes, droit_banque', { count: 'exact' })
      .eq('dossier_id', dossierId)
      .order('created_at')
      .order('id')
      .range(debut, fin))
    if (numero !== derniereLecture.current) return
    const rien = !lecture.complete && lecture.lignes.length === 0
    setErreurLecture(rien ? `La liste des accès n'a pas pu être lue (${lecture.motif ?? 'raison inconnue'}).` : null)
    setLecturePartielle(!lecture.complete && !rien ? lecture.motif : null)
    setRows(lecture.lignes)
    setChargement(false)
    setRelecture(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function handleCreateAccess(e: FormEvent) {
    e.preventDefault()
    if (creationEnCours.current) return
    creationEnCours.current = true
    setInviting(true)
    setError(null)
    try {
      // Passe par une fonction Edge (clé de service) plutôt qu'un signUp() classique côté navigateur :
      // retirer un accès (bouton "Retirer" ci-dessous) ne supprime que la ligne memberships, jamais le
      // compte Auth sous-jacent — un signUp() sur la même adresse pour un autre dossier échouerait donc
      // en "déjà inscrit". La fonction réutilise le compte existant le cas échéant. L'accès qu'elle crée n'a
      // aucun droit (les deux cases sont fausses par défaut en base) : le cabinet les coche ensuite.
      const { data, error: invokeError } = await supabase.functions.invoke<{ ok?: true; error?: string }>(
        'create-client-access',
        { body: { dossierId, email, password } },
      )
      // Sur un statut non-2xx, supabase-js jette systématiquement un FunctionsHttpError générique
      // ("Edge Function returned a non-2xx status code") dans invokeError SANS jamais remplir data
      // (voir lib/invokeErreur.ts) — le message précis qu'on renvoie nous-mêmes (403/409/500...) se
      // lit sur invokeError.context, jamais sur data.error (toujours undefined dans ce cas).
      if (data?.error) throw new Error(data.error)
      if (invokeError) throw new Error(await extraireErreurFonction(invokeError))
      if (!data?.ok) throw new Error("La création de l'accès n'a rien retourné.")

      setEmail('')
      setPassword('')
      load()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      creationEnCours.current = false
      setInviting(false)
    }
  }

  // Une case cochée ou décochée : `changer_droits_acces`, la seule écriture des droits — `memberships` n'a aucune policy de
  // mise à jour, et un `update` direct ne toucherait aucune ligne sans rien dire. N'envoie que le droit cliqué
  // (`demandeDeChangement`) : l'autre reste tel qu'en base. Refusé, le refus se dit avec la personne et le droit visés ;
  // la relecture remet la case comme la base l'a gardée.
  async function changerDroit(acces: AccesLu, domaine: Domaine, valeur: boolean) {
    if (ecritureDroitsEnCours.current) return
    ecritureDroitsEnCours.current = true
    setDroitEnCours({ id: acces.id, domaine, valeur })
    setErreurDroits(null)
    const personne = acces.email ?? acces.user_id
    try {
      const { data, error: erreurEcriture } = await supabase.rpc('changer_droits_acces', demandeDeChangement(acces.id, domaine, valeur))
      if (erreurEcriture) {
        setErreurDroits(messageDuRefus(domaine, personne, messageErreur(erreurEcriture, 'refus de la base.')))
      } else if (!changementApplique(data, domaine, valeur)) {
        setErreurDroits(messageDuRefus(domaine, personne, 'la base n’a pas rendu le droit demandé ; la liste relue fait foi.'))
      }
      await load()
    } finally {
      ecritureDroitsEnCours.current = false
      setDroitEnCours(null)
    }
  }

  async function revoke(row: AccesLu) {
    // Couper l'accès d'un client est réversible, mais pas d'un clic : il faut recréer l'accès ET
    // lui communiquer un nouveau mot de passe. C'était le seul geste destructeur de cet écran à
    // partir sans rien demander, dans une colonne d'actions où il voisine « Relancer ». Ses droits partent
    // avec lui : un accès recréé n'en a aucun, la confirmation le nomme.
    const droits = droitsDeLaLigne(row)
    const droitsTenus = DOMAINES.filter((d) => droits[d.domaine]).map((d) => `« ${d.libelle} »`)
    if (!window.confirm(
      `Retirer l'accès de ${row.email ?? 'ce compte'} au dossier ? Le client ne pourra plus déposer `
      + 'de pièces tant qu\'un nouvel accès ne lui aura pas été créé, avec un nouveau mot de passe.'
      + (droitsTenus.length > 0
        ? ` Ses droits ${droitsTenus.join(' et ')} partent avec lui : un nouvel accès n'en a pas, il faudra les recocher.`
        : ''),
    )) return
    // Le `load()` qui suit montre normalement l'échec (la ligne réapparaît) — sauf quand il échoue
    // pour la MÊME raison, et la liste se vide alors au lieu de garder sa ligne : l'écran dirait
    // « aucun accès » précisément quand l'accès est toujours là.
    const { error: deleteError } = await supabase.from('memberships').delete().eq('id', row.id)
    if (deleteError) {
      setError(messageErreur(deleteError, "L'accès n'a pas pu être retiré."))
      return
    }
    setError(null)
    load()
  }

  const adresseCollecte = codeEmail ? `${codeEmail}@${DOMAINE_COLLECTE_EMAIL}` : null

  async function copierAdresse() {
    if (!adresseCollecte) return
    try {
      await navigator.clipboard.writeText(adresseCollecte)
    } catch {
      // Le navigateur refuse le presse-papiers (permission, page non sécurisée) : sans ce `catch`, le clic ne faisait
      // rien et l'échec partait en erreur non gérée. L'adresse reste affichée, à copier à la main.
      if (!demonte.current) setCopieRefusee(true)
      return
    }
    if (demonte.current) return
    setCopieRefusee(false)
    setCopie(true)
    if (minuteurCopie.current !== null) clearTimeout(minuteurCopie.current)
    minuteurCopie.current = setTimeout(() => setCopie(false), 2000)
  }

  // Les cases ne s'offrent que sur une liste lue EN ENTIER ; lue en partie, chaque droit se lit, sans se changer.
  const casesOffertes = !chargement && erreurLecture === null && lecturePartielle === null

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Collecte automatique par e-mail</h3>
        <p className="muted" style={{ marginTop: -8 }}>
          Le client transfère ses e-mails de prélèvement récurrent (assurance, cotisations…) vers cette adresse —
          un simple réglage de transfert automatique dans sa boîte, sans jamais donner accès à sa messagerie.
          Les pièces jointes reçues arrivent directement en pièces à valider.
        </p>
        {adresseCollecte ? (
          <div className="field-row" style={{ alignItems: 'center' }}>
            <code style={{ background: 'var(--surface-2, #f4f4f4)', padding: '6px 10px', borderRadius: 6 }}>
              {adresseCollecte}
            </code>
            <button type="button" className="btn btn-outline btn-sm" onClick={copierAdresse}>
              {copie ? 'Copié ✓' : 'Copier'}
            </button>
            {copieRefusee && <span className="muted" role="status">Le navigateur a refusé la copie : sélectionne l'adresse pour la copier.</span>}
          </div>
        ) : (
          <p className="muted">Adresse en cours de génération — recharge la page si elle n'apparaît pas.</p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Donner un accès client</h3>
        <p className="muted" style={{ marginTop: -8 }}>{CE_QUE_DONNE_UN_ACCES}</p>
        <form onSubmit={handleCreateAccess}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="email">Email du client</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Mot de passe initial</label>
              <input id="password" type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="muted">10 caractères minimum — c'est toi qui le choisis et le communiques au client, pas lui.</span>
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={inviting}>
            {inviting ? 'Création…' : 'Créer l\'accès'}
          </button>
        </form>
      </div>

      <h3>Accès actuels</h3>
      <p className="muted" style={{ marginTop: -8 }}>{CE_QUE_DISENT_LES_CASES}</p>
      {rows.length > 0 && (
        <BandeauLecturePartielle
          quoi="La liste des accès" accord="lue" motif={lecturePartielle}
          consequence="Les droits ne se changent pas depuis une liste incomplète, et un accès qu'on ne voit pas ne se retire pas : recharge la page."
        />
      )}
      {relecture && !chargement && <p className="muted" role="status">Relecture de la liste des accès : les cases attendent son retour.</p>}
      {erreurDroits && <p className="error-text" role="alert">{erreurDroits}</p>}
      {/* Repliée en fiches sous 860 pixels de carte, comme l'équipe du cabinet : les deux cases et les boutons d'un accès
          passeraient sinon derrière un défilement latéral que rien n'annonce. */}
      <div className="card table-scroll tableau-adaptable" style={{ padding: 0 }}>
        {chargement ? (
          // Ni la liste ni « Aucun accès… » : tant que rien n'a été lu, ni l'une ni l'autre ne serait vraie.
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : erreurLecture === null && rows.length > 0 ? (
          <table className="table-empilable table-empilable-en-carte">
            <thead>
              <tr>
                <th>Utilisateur</th>
                {DOMAINES.map((d) => <th key={d.domaine}>{d.libelle}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const personne = r.email ?? r.user_id
                const droits = droitsDeLaLigne(r)
                return (
                  <tr key={r.id}>
                    <td data-libelle="Utilisateur">{personne}</td>
                    {DOMAINES.map((d) => (
                      <td key={d.domaine} data-libelle={d.libelle}>
                        {casesOffertes ? (
                          <input
                            type="checkbox"
                            aria-label={libelleDeLaCase(d.domaine, personne)}
                            checked={droitEnCours?.id === r.id && droitEnCours.domaine === d.domaine ? droitEnCours.valeur : droits[d.domaine]}
                            disabled={droitEnCours !== null || relecture}
                            onChange={(e) => changerDroit(r, d.domaine, e.target.checked)}
                          />
                        ) : (
                          <span>{droits[d.domaine] ? 'Oui' : 'Non'}</span>
                        )}
                      </td>
                    ))}
                    <td className="td-actions">
                      {r.email && (
                        <button className="btn btn-outline btn-sm" onClick={() => setRelanceDe(r)}>Relancer</button>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={() => revoke(r)}>Retirer</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : erreurLecture ? (
          <div className="empty-state error-text">
            {erreurLecture} On ne peut donc pas dire qui a accès à ce dossier — surtout ne pas en
            conclure que personne ne l'a. Recharge la page.
          </div>
        ) : (
          <div className="empty-state">Aucun accès client pour ce dossier.</div>
        )}
      </div>

      {relanceDe?.email && (
        <EnvoyerEmailModal
          dossierId={dossierId}
          type="relance_pieces"
          destinataireInitial={relanceDe.email}
          titre="Relancer pour obtenir des pièces"
          description={`Un e-mail invitant à se connecter pour déposer ses pièces sur "${dossierNom}".`}
          onClose={() => setRelanceDe(null)}
        />
      )}
    </>
  )
}
