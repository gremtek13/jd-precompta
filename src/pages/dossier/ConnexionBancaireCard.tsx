import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { extraireErreurFonction } from '../../lib/invokeErreur'
import { messageErreur } from '../../lib/messageErreur'
import { aujourdHuiSql, formatDate, formatMoney } from '../../lib/format'
import {
  JOURS_ALERTE_ACCORD, LIBELLES_TYPE_ACCES, joursAvantExpiration, periodeParDefaut, phraseEcartes, planImport, sourceDeLaConnexion,
  type BanqueProposee, type EnvironnementBancaire, type Recuperation, type StatutConnexion, type TypeAcces,
} from '../../lib/connexionBancaire'
import { statutPourLibelle } from '../../lib/reglesIgnorees'
import type { LigneBancaire, RegleBancaireIgnoree } from '../../lib/types'

// LA CONNEXION BANCAIRE D'UN DOSSIER (ligne 24 de la feuille de route), en preuve de concept sur le bac à
// sable d'Enable Banking. Tout passe par la fonction `banque-connexion` : cet écran ne voit jamais ni la
// clé de l'application, ni la session ouverte chez le prestataire, ni l'identifiant d'un compte.
//
// Un seul appel part à l'ouverture, `statut`, qui ne quitte pas le serveur de l'application. Tout ce qui
// parle au prestataire part d'un CLIC — la liste des banques comprise —, et rien ne s'écrit dans le relevé
// sans un second clic, « Importer », après qu'on a vu ce qui entrerait. Les mouvements importés arrivent
// « à traiter », comme ceux d'un relevé déposé.

type Lecture =
  | { etat: 'chargement' }
  | { etat: 'erreur'; message: string }
  | { etat: 'lue'; statut: StatutConnexion }

// Des lots de cette taille : un lot est une requête, et un relevé récupéré sur une longue période peut
// compter des milliers de mouvements.
const TAILLE_LOT = 500
// L'aperçu montre les premiers mouvements à importer, et dit combien il en tait.
const APERCU_MAX = 50

// Un refus de la fonction porte parfois un DRAPEAU à côté de sa phrase : `fermeture_impossible` quand la
// banque n'a pas pu être prévenue d'un retrait — c'est lui, et lui seul, qui ouvre « Retirer quand
// même » : un retrait refusé par la base ne se force pas, et la question posée alors serait fausse.
// `periode_refusee` quand la banque refuse la période demandée : sans nouvel accord, elle ne rend que
// les 90 derniers jours, et c'est lui qui offre de renouveler l'accord.
interface Drapeaux { fermeture_impossible: boolean; periode_refusee: boolean }
const SANS_DRAPEAU: Drapeaux = { fermeture_impossible: false, periode_refusee: false }

type Reponse<T> = { donnees: T; erreur: null; drapeaux: Drapeaux } | { donnees: null; erreur: string; drapeaux: Drapeaux }

async function appeler<T>(corps: Record<string, unknown>, repli: string): Promise<Reponse<T>> {
  const { data, error } = await supabase.functions.invoke<T>('banque-connexion', { body: corps })
  if (!error && data) return { donnees: data, erreur: null, drapeaux: SANS_DRAPEAU }
  // Le corps d'une réponse ne se lit qu'UNE fois : une COPIE pour les drapeaux, et l'original à
  // `extraireErreurFonction`, qui en tire la phrase — `invoke()` lève avant d'avoir lu le corps, et seul
  // `error.context` la porte (voir lib/invokeErreur.ts).
  const contexte = (error as { context?: unknown } | null)?.context
  const copie = contexte instanceof Response && !contexte.bodyUsed ? contexte.clone() : null
  const erreur = await extraireErreurFonction(error, repli)
  let drapeaux = SANS_DRAPEAU
  if (copie) {
    try {
      const corpsErreur = (await copie.json()) as { fermeture_impossible?: unknown; periode_refusee?: unknown } | null
      drapeaux = {
        fermeture_impossible: corpsErreur?.fermeture_impossible === true,
        periode_refusee: corpsErreur?.periode_refusee === true,
      }
    } catch {
      // Un corps qui n'est pas du JSON (délai de la plateforme) ne porte aucun drapeau.
    }
  }
  return { donnees: null, erreur, drapeaux }
}

const cleBanque = (b: Pick<BanqueProposee, 'nom' | 'pays'>) => `${b.pays}|${b.nom}`

const lireStatut = (dossierId: string) =>
  appeler<StatutConnexion>({ action: 'statut', dossierId }, "La connexion bancaire du dossier n'a pas pu être lue.")
const lectureDe = (r: Reponse<StatutConnexion>): Lecture =>
  r.erreur !== null ? { etat: 'erreur', message: r.erreur } : { etat: 'lue', statut: r.donnees }

export default function ConnexionBancaireCard({ dossierId, lignes, regles, suspension, onImported }: {
  dossierId: string
  // Le relevé du dossier : la période proposée en part, et ce qui y est déjà ne se réimporte pas.
  lignes: LigneBancaire[]
  // Les règles « toujours ignorer » : elles décident du statut ÉCRIT à l'import, comme pour un fichier.
  regles: RegleBancaireIgnoree[]
  // Non nul quand le relevé ou les règles n'ont pas été lus en entier : l'import se suspend, comme celui
  // d'un fichier — un mouvement déjà dans un relevé importé ne se reconnaîtrait plus, et une règle non
  // lue laisserait « à traiter » ce qu'elle couvre.
  suspension: string | null
  onImported: () => void
}) {
  const [lecture, setLecture] = useState<Lecture>({ etat: 'chargement' })
  // Un seul verrou pour toutes les actions : chacune parle au prestataire ou écrit, et deux qui se
  // croiseraient laisseraient la connexion dans un état qu'aucune des deux n'a voulu — deux demandes
  // d'accord, dont la première ne pourrait plus aboutir.
  const verrou = useRef(false)
  const [occupe, setOccupe] = useState(false)
  // Le navigateur part vers la banque : plus rien ne doit partir d'ici, le verrou étant déjà relâché.
  const [redirection, setRedirection] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [banques, setBanques] = useState<{ environnement: EnvironnementBancaire | null; liste: BanqueProposee[] } | null>(null)
  const [choix, setChoix] = useState<{ banque: string; type: TypeAcces | '' }>({ banque: '', type: '' })
  const [periode, setPeriode] = useState<{ du: string; au: string } | null>(null)
  const [recuperation, setRecuperation] = useState<Recuperation | null>(null)
  const [changerDeCompte, setChangerDeCompte] = useState(false)
  // Le retrait a échoué parce que la banque n'a pas pu être prévenue : « Retirer quand même » est offert.
  const [retraitRefuse, setRetraitRefuse] = useState(false)
  // La banque a refusé la période demandée : « Renouveler l'accord » est offert à côté des dates.
  const [periodeRefusee, setPeriodeRefusee] = useState(false)
  // Une lecture complète faite ICI, sous l'accord en cours : la connexion affichée ne porte pas encore sa
  // date. La relire pour l'avoir ferait dépendre l'aperçu d'une seconde lecture — qui, en échouant,
  // effacerait la carte entière, aperçu compris.
  const [lueIci, setLueIci] = useState(false)

  useEffect(() => {
    let annule = false
    ;(async () => {
      const r = await lireStatut(dossierId)
      if (!annule) setLecture(lectureDe(r))
    })()
    return () => { annule = true }
  }, [dossierId])

  // Relue SOUS le verrou, après chaque action qui change la connexion : relâché avant, l'écran montrerait
  // encore la connexion d'avant — un compte déjà changé, une connexion déjà retirée — le temps que la
  // relecture revienne, et un clic partirait sur elle.
  async function relire() {
    setLecture(lectureDe(await lireStatut(dossierId)))
  }

  async function sousVerrou(action: () => Promise<void>) {
    if (verrou.current || redirection) return
    verrou.current = true
    setOccupe(true)
    // Le drapeau suit la phrase qu'il accompagne : une nouvelle action efface l'une et l'autre.
    setErreur(null)
    setPeriodeRefusee(false)
    setInfo(null)
    try {
      await action()
    } catch (e) {
      setErreur(messageErreur(e, "L'action n'a pas abouti."))
    } finally {
      verrou.current = false
      setOccupe(false)
    }
  }

  const statut = lecture.etat === 'lue' ? lecture.statut : null
  const connexion = statut?.connexion ?? null
  const environnement = connexion?.environnement ?? banques?.environnement ?? null
  const bloque = occupe || redirection
  // Une lecture complète déjà faite sous l'accord en cours : la banque ne rend plus que 90 jours. La
  // fonction remet `derniere_recuperation` à zéro à chaque accord, c'est ce qui rend ce signal juste.
  const periodeProposee = periodeParDefaut(lignes, aujourdHuiSql(), lueIci || connexion?.derniere_recuperation != null)
  // La période voulue ne se lit plus sans nouvel accord. Tu tant qu'un aperçu est à l'écran : juste
  // après une lecture réussie, dire « la banque ne rend plus que 90 jours » contredirait ce qu'on voit.
  const bornePourLAccord = periode === null && periodeProposee.debutVoulu !== null && !recuperation
    ? periodeProposee.debutVoulu : null
  const periodeAffichee = periode ?? { du: periodeProposee.du, au: periodeProposee.au }
  // Des jours ENTIERS arrondis vers le bas : négatif dès que l'échéance est passée, fût-ce d'une seconde.
  const jours = connexion ? joursAvantExpiration(connexion.valide_jusqu_au, new Date()) : null
  const expire = jours !== null && jours < 0
  // L'accord expire ou a expiré : le bouton de renouvellement vit alors en tête de la carte, et c'est le
  // seul — deux « Renouveler l'accord » dans la même carte feraient se demander lequel.
  const alerteAccord = expire || (jours !== null && jours <= JOURS_ALERTE_ACCORD)
  const compteChoisi = connexion?.comptes.find((c) => c.empreinte === connexion.compte_empreinte) ?? null
  const plan = recuperation ? planImport(recuperation.mouvements, lignes) : null
  const banqueChoisie = banques?.liste.find((b) => cleBanque(b) === choix.banque) ?? null

  const chargerBanques = () => sousVerrou(async () => {
    const r = await appeler<{ environnement: EnvironnementBancaire | null; banques: BanqueProposee[] }>(
      { action: 'banques', dossierId }, "La liste des banques n'a pas pu être lue.")
    if (r.erreur !== null) { setErreur(r.erreur); return }
    setBanques({ environnement: r.donnees.environnement, liste: r.donnees.banques })
    const premiere = r.donnees.banques[0]
    setChoix({ banque: premiere ? cleBanque(premiere) : '', type: premiere ? typeParDefaut(premiere) : '' })
  })

  // Vers la banque. La demande est enregistrée par la fonction AVANT de rendre l'adresse : au retour, la
  // page `retour-banque` la retrouve à son jeton.
  const allerALaBanque = (corps: Record<string, unknown>) => sousVerrou(async () => {
    const r = await appeler<{ url: string }>({ action: 'demarrer', dossierId, ...corps }, "La demande d'accord n'a pas pu partir.")
    if (r.erreur !== null) { setErreur(r.erreur); await relire(); return }
    setRedirection(true)
    window.location.assign(r.donnees.url)
  })

  const choisirCompte = (empreinte: string) => sousVerrou(async () => {
    const r = await appeler<{ ok: true }>({ action: 'choisir_compte', dossierId, empreinte }, "Le compte n'a pas pu être retenu.")
    if (r.erreur !== null) { setErreur(r.erreur); return }
    setChangerDeCompte(false)
    setRecuperation(null)
    await relire()
  })

  const recuperer = () => sousVerrou(async () => {
    setRecuperation(null)
    const r = await appeler<Recuperation>(
      { action: 'mouvements', dossierId, du: periodeAffichee.du, au: periodeAffichee.au }, "Les mouvements n'ont pas pu être récupérés.")
    if (r.erreur !== null) { setErreur(r.erreur); setPeriodeRefusee(r.drapeaux.periode_refusee); return }
    setRecuperation(r.donnees)
    if (r.donnees.complete) setLueIci(true)
  })

  const importer = () => sousVerrou(async () => {
    if (!recuperation || !recuperation.complete || suspension !== null) return
    const aImporter = planImport(recuperation.mouvements, lignes).aImporter
    if (aImporter.length === 0) return
    if (recuperation.environnement === 'SANDBOX' && !window.confirm(
      'Ces mouvements viennent du BAC À SABLE : la banque et ses mouvements sont fictifs. Les importer quand même ' +
      'dans le relevé de ce dossier ?')) return
    const source = sourceDeLaConnexion(recuperation.banque_nom)
    const aEcrire = aImporter.map((m) => ({
      dossier_id: dossierId, date: m.date, libelle: m.libelle, montant: m.montant,
      statut: statutPourLibelle(m.libelle, regles), source_fichier: source, id_externe: m.id_externe,
    }))
    // Ce que la base a VRAIMENT écrit : `ignoreDuplicates` laisse tel quel un mouvement qu'un autre onglet
    // — ou un collègue — vient d'importer (`lignes_bancaires_id_externe_unique`), au lieu de faire échouer le
    // lot. Compter ce qu'on a envoyé annoncerait ces mouvements-là comme importés deux fois.
    const ecrits = new Set<string>()
    for (let i = 0; i < aEcrire.length; i += TAILLE_LOT) {
      const lot = aEcrire.slice(i, i + TAILLE_LOT)
      const { data, error } = await supabase.from('lignes_bancaires')
        .upsert(lot, { onConflict: 'dossier_id,id_externe', ignoreDuplicates: true })
        .select('id_externe')
      if (error) {
        setErreur(`L'import s'est arrêté après ${ecrits.size} mouvement(s) (${messageErreur(error, 'refus de la base')}). ` +
          "Le relancer n'importe pas deux fois le même mouvement.")
        onImported()
        return
      }
      for (const l of (data ?? []) as { id_externe: string | null }[]) if (l.id_externe) ecrits.add(l.id_externe)
    }
    const ignores = aEcrire.filter((l) => ecrits.has(l.id_externe) && l.statut === 'ignoree').length
    const dejaLa = aEcrire.length - ecrits.size
    setRecuperation(null)
    setPeriode(null)
    setInfo(`${ecrits.size} mouvement(s) importé(s) dans le relevé, à traiter comme ceux d'un fichier` +
      (ignores > 0 ? ` — dont ${ignores} ignoré(s) par une règle « toujours ignorer »` : '') +
      (dejaLa > 0 ? `. ${dejaLa} déjà importé(s) entre-temps depuis un autre écran : laissé(s) tel(s) quel(s).` : '.'))
    onImported()
  })

  const retirer = (forcer: boolean) => sousVerrou(async () => {
    if (!connexion) return
    const question = connexion.etat === 'en_attente'
      ? `Abandonner la demande de connexion à ${connexion.banque_nom} ?`
      : forcer
        ? `Retirer quand même la connexion à ${connexion.banque_nom} ? La banque n'a pas pu être prévenue : l'accord ` +
          `restera ouvert chez elle${connexion.valide_jusqu_au ? ` jusqu'au ${formatDate(connexion.valide_jusqu_au)}` : ''}, ` +
          "sans plus rien qui permette à l'application de s'en servir."
        : `Retirer la connexion à ${connexion.banque_nom} ? L'accord est refermé chez la banque. Les mouvements déjà ` +
          'importés restent dans le relevé ; il faudra reconnecter la banque pour récupérer les suivants.'
    if (!window.confirm(question)) return
    const r = await appeler<{ ok: true }>({ action: 'retirer', dossierId, forcer }, "La connexion n'a pas pu être retirée.")
    if (r.erreur !== null) {
      setErreur(r.erreur)
      setRetraitRefuse(r.drapeaux.fermeture_impossible)
      return
    }
    setRetraitRefuse(false)
    setRecuperation(null)
    setBanques(null)
    await relire()
  })

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        Connexion bancaire
        {environnement === 'SANDBOX' && <span className="badge badge-warning">Bac à sable</span>}
      </h3>

      {lecture.etat === 'chargement' && <p className="muted" style={{ margin: 0 }}>Chargement…</p>}

      {/* Une lecture ratée ne dit PAS « aucune banque connectée » : ce serait inviter à en connecter une
          seconde, que la base refuserait, ou à croire l'accord retiré. */}
      {lecture.etat === 'erreur' && (
        <>
          <p className="error-text">{lecture.message}</p>
          <button type="button" className="btn btn-outline btn-sm" disabled={bloque} onClick={() => sousVerrou(relire)}>Réessayer</button>
        </>
      )}

      {environnement === 'SANDBOX' && (
        <p className="muted">
          Bac à sable : la banque et ses mouvements sont <strong>fictifs</strong>. Ne les importe que dans un dossier d'essai.
        </p>
      )}

      {statut && !connexion && !statut.configuree && (
        <p className="muted" style={{ margin: 0 }}>
          La connexion bancaire n'est pas encore configurée : la clé privée de l'application Enable Banking doit être
          posée dans les secrets des fonctions Supabase (ENABLE_BANKING_CLE_PRIVEE).
        </p>
      )}

      {statut && !connexion && statut.configuree && (
        <>
          <p className="muted">
            Récupère les mouvements du compte directement à la banque, sans déposer de relevé. Le titulaire du compte
            donne son accord sur le site de sa banque, avec ses propres identifiants, pour 180 jours au plus.
          </p>
          {!banques && (
            <button type="button" className="btn btn-primary btn-sm" disabled={bloque} onClick={chargerBanques}>
              Connecter une banque
            </button>
          )}
          {banques && banques.liste.length === 0 && (
            <p className="error-text">Le prestataire ne propose aucune banque pour ce pays.</p>
          )}
          {banques && banques.liste.length > 0 && (
            <div className="field-row aligne-bas">
              <div className="field">
                <label htmlFor="banque-a-connecter">Banque</label>
                <select
                  id="banque-a-connecter"
                  value={choix.banque}
                  onChange={(e) => {
                    const b = banques.liste.find((x) => cleBanque(x) === e.target.value)
                    setChoix({ banque: e.target.value, type: b ? typeParDefaut(b) : '' })
                  }}
                >
                  {banques.liste.map((b) => <option key={cleBanque(b)} value={cleBanque(b)}>{b.nom}</option>)}
                </select>
              </div>
              {banqueChoisie && banqueChoisie.types_acces.length > 1 && (
                <div className="field">
                  <label htmlFor="espace-de-connexion">Espace de connexion</label>
                  <select id="espace-de-connexion" value={choix.type} onChange={(e) => setChoix({ ...choix, type: e.target.value as TypeAcces })}>
                    {banqueChoisie.types_acces.map((t) => <option key={t} value={t}>{majuscule(LIBELLES_TYPE_ACCES[t])}</option>)}
                  </select>
                </div>
              )}
              <div className="field">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={bloque || !banqueChoisie || choix.type === ''}
                  onClick={() => banqueChoisie && allerALaBanque({
                    banque: { nom: banqueChoisie.nom, pays: banqueChoisie.pays }, type_acces: choix.type,
                  })}
                >
                  Aller sur le site de la banque
                </button>
              </div>
            </div>
          )}
          {banqueChoisie && banqueChoisie.types_acces.length === 1 && (
            <p className="muted" style={{ marginBottom: 0 }}>
              Connexion par l'{LIBELLES_TYPE_ACCES[banqueChoisie.types_acces[0]]} de la banque.
            </p>
          )}
        </>
      )}

      {connexion?.etat === 'en_attente' && (
        <>
          <p>La connexion à <strong>{connexion.banque_nom}</strong> n'a pas été menée à son terme.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={bloque || !statut?.configuree}
              onClick={() => allerALaBanque({
                banque: { nom: connexion.banque_nom, pays: connexion.banque_pays }, type_acces: connexion.type_acces,
              })}
            >
              Reprendre
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={bloque} onClick={() => retirer(false)}>
              Abandonner
            </button>
          </div>
        </>
      )}

      {connexion?.etat === 'active' && (
        <>
          <p style={{ marginTop: 0 }}>
            <strong>{connexion.banque_nom}</strong> · {LIBELLES_TYPE_ACCES[connexion.type_acces]}
            {connexion.valide_jusqu_au && <> · accord {expire ? 'expiré le' : "jusqu'au"} {formatDate(connexion.valide_jusqu_au)}</>}
            {connexion.derniere_recuperation && <> · dernière récupération complète le {formatDate(connexion.derniere_recuperation)}</>}
          </p>

          {expire && (
            <p className="error-text">L'accord de la banque a expiré : renouvelle-le pour récupérer les mouvements.</p>
          )}
          {!expire && jours !== null && jours <= JOURS_ALERTE_ACCORD && (
            <p className="muted">
              L'accord expire dans {jours <= 0 ? 'moins d’un jour' : `${jours} jour${jours > 1 ? 's' : ''}`} : renouvelle-le
              pour ne pas interrompre la récupération.
            </p>
          )}
          {alerteAccord && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={bloque || !statut?.configuree}
              onClick={() => allerALaBanque({ renouveler: true })}
              style={{ marginBottom: 12 }}
            >
              Renouveler l'accord
            </button>
          )}

          {(!compteChoisi || changerDeCompte) && (
            <>
              <p style={{ marginBottom: 6 }}>
                {compteChoisi
                  ? "Choisis l'autre compte à importer. Les mouvements déjà importés restent ; ceux du nouveau compte s'ajouteront au même relevé."
                  : "Choisis le compte dont importer les mouvements :"}
              </p>
              {connexion.comptes.length === 0 && (
                <p className="error-text">L'accord n'ouvre aucun compte que l'application sache suivre.</p>
              )}
              <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
                {connexion.comptes.map((c) => {
                  const refus = !c.mouvements_lisibles
                    ? 'la banque ne rend pas ses mouvements (fermé ou bloqué)'
                    : c.devise !== 'EUR' ? `tenu en ${c.devise ?? 'devise inconnue'}, et le relevé l'est en euros` : null
                  return (
                    <li key={c.empreinte} style={{ marginBottom: 6 }}>
                      {c.nom ?? 'Compte'}{c.iban_fin && <> ····{c.iban_fin}</>}{c.devise && <> ({c.devise})</>}
                      {' '}
                      {c.empreinte === connexion.compte_empreinte
                        ? <span className="badge badge-ok">choisi</span>
                        : refus
                          ? <span className="muted">— {refus}</span>
                          : (
                            <button type="button" className="btn btn-outline btn-sm" disabled={bloque} onClick={() => choisirCompte(c.empreinte)}>
                              Choisir ce compte
                            </button>
                          )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {compteChoisi && !changerDeCompte && (
            <>
              <p style={{ marginBottom: 8 }}>
                Compte choisi : {compteChoisi.nom ?? 'compte'}{compteChoisi.iban_fin && <> ····{compteChoisi.iban_fin}</>}
                {connexion.comptes.length > 1 && (
                  <>
                    {' '}
                    <button type="button" className="btn btn-outline btn-sm" disabled={bloque} onClick={() => setChangerDeCompte(true)}>
                      Changer de compte
                    </button>
                  </>
                )}
              </p>
              <div className="field-row aligne-bas">
                <div className="field">
                  <label htmlFor="recuperation-du">Du</label>
                  <input id="recuperation-du" type="date" value={periodeAffichee.du}
                    onChange={(e) => setPeriode({ ...periodeAffichee, du: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="recuperation-au">Au</label>
                  <input id="recuperation-au" type="date" value={periodeAffichee.au}
                    onChange={(e) => setPeriode({ ...periodeAffichee, au: e.target.value })} />
                </div>
                <div className="field">
                  <button type="button" className="btn btn-primary btn-sm" disabled={bloque || expire} onClick={recuperer}>
                    Récupérer les mouvements
                  </button>
                </div>
              </div>
              {bornePourLAccord && (
                <p className="muted" style={{ marginBottom: 6 }}>
                  Après une première lecture, la banque ne rend plus que les 90 derniers jours : la période commence le{' '}
                  {formatDate(periodeAffichee.du)} au lieu du {formatDate(bornePourLAccord)}. Pour récupérer depuis le{' '}
                  {formatDate(bornePourLAccord)}, renouvelle l'accord : la première lecture qui le suit peut remonter plus loin.
                </p>
              )}
              {(bornePourLAccord || periodeRefusee) && !alerteAccord && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={bloque || !statut?.configuree}
                  onClick={() => allerALaBanque({ renouveler: true })}
                >
                  Renouveler l'accord
                </button>
              )}
            </>
          )}

          {recuperation && plan && (
            <div style={{ marginTop: 12 }}>
              <p style={{ marginBottom: 6 }}>
                Du {formatDate(recuperation.du)} au {formatDate(recuperation.au)} : {recuperation.mouvements.length} mouvement(s)
                lu(s) — <strong>{plan.aImporter.length} à importer</strong>
                {plan.dejaImportes.length > 0 && <>, {plan.dejaImportes.length} déjà importé(s)</>}
                {plan.dansUnReleve.length > 0 && (
                  <>, {plan.dansUnReleve.length} déjà dans un relevé importé en fichier (même date, même montant)</>
                )}.
              </p>
              {phraseEcartes(recuperation.ecartes) && <p className="muted" style={{ marginTop: 0 }}>{phraseEcartes(recuperation.ecartes)}</p>}
              {recuperation.avertissement && <p className="muted">{recuperation.avertissement}</p>}
              {!recuperation.complete && (
                <p className="error-text">
                  Lecture incomplète : {recuperation.motif ?? 'la banque n’a pas tout rendu'}. L'import est suspendu — un import
                  partiel ferait repartir la prochaine récupération après des mouvements jamais lus.
                </p>
              )}
              {suspension !== null && (
                <p className="error-text">
                  Import suspendu : une lecture de l'onglet est incomplète ({suspension}). Un mouvement déjà dans le relevé ne se
                  reconnaîtrait plus. Recharge la page.
                </p>
              )}
              {plan.aImporter.length > 0 && (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Date</th><th>Libellé</th><th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
                    <tbody>
                      {plan.aImporter.slice(0, APERCU_MAX).map((m) => (
                        <tr key={m.id_externe}>
                          <td>{formatDate(m.date)}</td>
                          <td>{m.libelle}</td>
                          <td style={{ textAlign: 'right' }}>{formatMoney(m.montant)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {plan.aImporter.length > APERCU_MAX && (
                <p className="muted">… et {plan.aImporter.length - APERCU_MAX} autre(s).</p>
              )}
              {plan.aImporter.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: 8 }}
                  disabled={bloque || !recuperation.complete || suspension !== null}
                  onClick={importer}
                >
                  Importer les {plan.aImporter.length} mouvement(s)
                </button>
              )}
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline btn-sm" disabled={bloque} onClick={() => retirer(false)}>
              Retirer la connexion
            </button>
            {retraitRefuse && (
              <button type="button" className="btn btn-danger btn-sm" disabled={bloque} onClick={() => retirer(true)}>
                Retirer quand même
              </button>
            )}
          </div>
        </>
      )}

      {erreur && <p className="error-text">{erreur}</p>}
      {info && <p className="muted">{info}</p>}
    </div>
  )
}

/** L'espace proposé d'abord : professionnel quand la banque l'offre. */
function typeParDefaut(b: BanqueProposee): TypeAcces | '' {
  return b.types_acces.includes('business') ? 'business' : (b.types_acces[0] ?? '')
}

function majuscule(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1)
}
