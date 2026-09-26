import { useEffect, useRef, useState } from 'react'
import { controlerBalance, lireBalance, type ControleBalance, type ResultatLectureBalance } from '../../lib/balanceImport'
import { dateOuverture, preparerANouveaux } from '../../lib/aNouveaux'
import { parseCsv } from '../../lib/csv'
import { hashFichier } from '../../lib/extraction'
import { formatDate, formatMoney } from '../../lib/format'
import { lireTout } from '../../lib/lectureComplete'
import { messageErreur } from '../../lib/messageErreur'
import { supabase } from '../../lib/supabase'
import type { ANouveau } from '../../lib/types'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'

// La reprise d'un dossier venu d'un autre logiciel. Deux temps, et c'est ce qui la rend sûre :
//
//   1. LIRE ET CONTRÔLER la balance (`lib/balanceImport.ts`) — « cet export de mon ancien logiciel
//      est-il entier ? » se répond avant tout le reste. Une balance qui ne boucle pas n'est pas une
//      balance, c'est un fichier amputé.
//   2. EN FAIRE LES À-NOUVEAUX du dossier (`lib/aNouveaux.ts`), sur un clic, après avoir montré ce qui
//      sera écrit — décision du cabinet du 26/09/2026 (ligne 29 de la feuille de route). Rien ne part
//      sans ce clic, et l'enregistrement se fait en une transaction qui REMPLACE l'ouverture
//      précédente plutôt que de s'y ajouter : un dossier n'a qu'une ouverture.
//
// L'empreinte du fichier voyage avec les à-nouveaux : elle est leur justificatif dans la piste
// d'audit, comme celle d'une pièce.

// Un export comptable français sort souvent en CP1252, pas en UTF-8 : les libellés sont les NOMS DE
// COMPTES, donc l'essentiel de ce qu'un humain lit sur cet écran. Décoder de travers rendrait
// « Fournisseurs » en « Fournisseurs » et ferait douter du reste. On tente l'UTF-8 en mode strict —
// qui LÈVE sur une séquence invalide, là où le mode indulgent rend un U+FFFD qu'il faudrait ensuite
// aller renifler — et on retombe sur windows-1252, qui ne peut pas échouer.
// Les CHIFFRES, eux, sont de l'ASCII dans les deux cas : le contrôle d'équilibre reste juste même si
// ce repli se trompait.
function decoder(octets: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets)
  } catch {
    return new TextDecoder('windows-1252').decode(octets)
  }
}

const pluriel = (n: number, mot: string, marque = 's') => `${n} ${mot}${n > 1 ? marque : ''}`

export default function BalanceCard({ dossierId }: { dossierId: string }) {
  const [nomFichier, setNomFichier] = useState<string | null>(null)
  const [empreinte, setEmpreinte] = useState<string | null>(null)
  const [lecture, setLecture] = useState<ResultatLectureBalance | null>(null)
  const [controle, setControle] = useState<ControleBalance | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  // L'ouverture déjà enregistrée. Relue après chaque enregistrement ou retrait (`version`).
  const [ouverture, setOuverture] = useState<ANouveau[]>([])
  const [ouvertureIllisible, setOuvertureIllisible] = useState<string | null>(null)
  const [ouvertureChargee, setOuvertureChargee] = useState(false)
  const [version, setVersion] = useState(0)

  // L'exercice qu'ouvrent les soldes : d'ordinaire celui qui suit la balance, donc l'année en cours
  // pour un dossier repris maintenant. Un choix du cabinet, montré avant d'enregistrer.
  const [exercice, setExercice] = useState(() => new Date().getFullYear())
  const [enregistrement, setEnregistrement] = useState(false)
  // Verrou d'exécution : `enregistrement` est un état React, qui ne prend effet qu'au rendu suivant —
  // deux clics du même rendu passeraient tous deux.
  const enregistrementEnCours = useRef(false)
  const [retrait, setRetrait] = useState(false)
  const [erreurEnregistrement, setErreurEnregistrement] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  useEffect(() => {
    let annule = false
    lireTout<ANouveau>((debut, fin) =>
      supabase.from('a_nouveaux').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('compte').order('id').range(debut, fin),
    ).then((lectureOuverture) => {
      if (annule) return
      setOuverture(lectureOuverture.lignes)
      setOuvertureIllisible(lectureOuverture.motif)
      setOuvertureChargee(true)
    })
    return () => { annule = true }
  }, [dossierId, version])

  async function choisir(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0]
    // Réinitialiser AVANT de lire : sans ça, un second fichier illisible laisserait à l'écran le
    // résultat du premier, sous le nom du second — et l'enregistrerait sous l'empreinte du premier.
    setLecture(null)
    setControle(null)
    setErreur(null)
    setEmpreinte(null)
    setConfirmation(null)
    setErreurEnregistrement(null)
    setNomFichier(fichier?.name ?? null)
    e.target.value = ''
    if (!fichier) return

    setEnCours(true)
    try {
      const [octets, hash] = await Promise.all([fichier.arrayBuffer(), hashFichier(fichier)])
      const resultat = lireBalance(parseCsv(decoder(octets)))
      setLecture(resultat)
      setControle(controlerBalance(resultat.lignes))
      setEmpreinte(hash)
    } catch (err) {
      setErreur(messageErreur(err, 'Ce fichier n’a pas pu être lu.'))
    } finally {
      setEnCours(false)
    }
  }

  // Seulement sur une balance reconnue ET équilibrée : sur un fichier amputé, préparer des à-nouveaux
  // reviendrait à ouvrir un dossier sur des soldes dont on sait qu'ils sont faux.
  const preparation = lecture?.colonnes && controle?.equilibree ? preparerANouveaux(lecture.lignes, exercice) : null
  const anneeCourante = new Date().getFullYear()
  const exercicesProposes = [anneeCourante - 3, anneeCourante - 2, anneeCourante - 1, anneeCourante, anneeCourante + 1]

  async function enregistrer() {
    if (!preparation || preparation.refus || !empreinte || !nomFichier) return
    // Une lecture partielle ne commande pas d'écriture : ici l'enregistrement REMPLACE une ouverture
    // qu'on n'a pas pu lire, donc qu'on ne peut pas nommer dans la confirmation.
    if (ouvertureIllisible !== null || !ouvertureChargee) return
    if (enregistrementEnCours.current) return
    if (ouverture.length > 0 && !window.confirm(
      `Remplacer les ${pluriel(ouverture.length, 'à-nouveau', 'x')} du ${formatDate(ouverture[0].date)}, `
      + `repris de ${ouverture[0].source_nom} ? Ils seront effacés, et ceux de ${nomFichier} ouvriront `
      + `l’exercice ${exercice} à leur place.`,
    )) return
    enregistrementEnCours.current = true
    setEnregistrement(true)
    setErreurEnregistrement(null)
    setConfirmation(null)
    try {
      const { error } = await supabase.rpc('enregistrer_a_nouveaux', {
        p_dossier_id: dossierId,
        p_date: dateOuverture(exercice),
        p_source_nom: nomFichier,
        p_source_empreinte: empreinte,
        p_lignes: preparation.lignes.map((l) => ({
          compte: l.compte, compte_origine: l.compteOrigine ?? '', libelle: l.libelle, sens: l.sens, montant: l.montant,
        })),
      })
      if (error) throw error
      setConfirmation(`${pluriel(preparation.lignes.length, 'à-nouveau', 'x')} enregistré${preparation.lignes.length > 1 ? 's' : ''} : `
        + `ils ouvrent l’exercice ${exercice}.`)
      setVersion((v) => v + 1)
    } catch (err) {
      setErreurEnregistrement(messageErreur(err, 'Les à-nouveaux n’ont pas pu être enregistrés.'))
    } finally {
      enregistrementEnCours.current = false
      setEnregistrement(false)
    }
  }

  async function retirer() {
    if (ouverture.length === 0) return
    // La confirmation NOMME ce qu'on perd : « Êtes-vous sûr ? » se ferme d'un clic aussi distrait que
    // le premier.
    if (!window.confirm(
      `Retirer les ${pluriel(ouverture.length, 'à-nouveau', 'x')} du ${formatDate(ouverture[0].date)}, `
      + `repris de ${ouverture[0].source_nom} ? La trésorerie, la balance des comptes, le FEC et la piste `
      + `d’audit repartiront de zéro à la première écriture. La balance reprise n’est pas conservée : il `
      + 'faudra la redéposer pour les recréer.',
    )) return
    setRetrait(true)
    setErreurEnregistrement(null)
    setConfirmation(null)
    const { error } = await supabase.from('a_nouveaux').delete().eq('dossier_id', dossierId)
    setRetrait(false)
    if (error) {
      setErreurEnregistrement(messageErreur(error, 'Les à-nouveaux n’ont pas pu être retirés.'))
      return
    }
    setVersion((v) => v + 1)
  }

  // « Ce fichier n'est pas une balance » et « cette balance est vide » ne se disent pas pareil : un
  // relevé bancaire déposé par erreur rend `colonnes: null`, et l'annoncer comme une balance vide
  // enverrait chercher un défaut dans le fichier plutôt que dans le geste. Distinction portée par le
  // module ; l'écran ne doit pas la reperdre.
  const pasUneBalance = lecture !== null && lecture.colonnes === null
  const totalOuverture = ouverture.filter((a) => a.sens === 'debit').reduce((s, a) => s + a.montant, 0)

  return (
    <div className="card" style={{ maxWidth: 640, marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Balance d’un autre logiciel</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Dépose la balance générale exportée du logiciel précédent (CSV) : elle est d’abord lue et
        contrôlée — les colonnes sont reconnues à leur contenu, la colonne des comptes étant celle qui
        porte des numéros du plan comptable. Équilibrée, ses soldes de bilan peuvent devenir les
        à-nouveaux du dossier, sur ton clic et après t’avoir montré ce qui sera écrit.
      </p>

      <BandeauLecturePartielle
        quoi="Les à-nouveaux du dossier"
        accord="lus"
        motif={ouvertureIllisible}
        consequence={
          'L’enregistrement d’une nouvelle ouverture est suspendu : il remplacerait des à-nouveaux qu’on ' +
          'n’a pas pu lire. Recharge la page.'
        }
      />
      {ouvertureChargee && ouvertureIllisible === null && (ouverture.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: '0 0 6px' }}>
            <strong>Ouverture enregistrée</strong>{' : '}
            {`${pluriel(ouverture.length, 'à-nouveau', 'x')} au ${formatDate(ouverture[0].date)}, repris de `
              + `${ouverture[0].source_nom} (${formatMoney(totalOuverture)} au débit comme au crédit).`}
          </p>
          <details>
            <summary>Voir les soldes d’ouverture</summary>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Compte</th><th>Libellé</th><th>Débit</th><th>Crédit</th></tr></thead>
                <tbody>
                  {ouverture.map((a) => (
                    <tr key={a.id}>
                      <td>{a.compte}{a.compte_origine && a.compte_origine !== a.compte ? ` (${a.compte_origine})` : ''}</td>
                      <td>{a.libelle}</td>
                      <td>{a.sens === 'debit' ? formatMoney(a.montant) : ''}</td>
                      <td>{a.sens === 'credit' ? formatMoney(a.montant) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <button type="button" className="btn btn-danger btn-sm" style={{ marginTop: 8 }} onClick={retirer} disabled={retrait}>
            {retrait ? 'Retrait…' : 'Retirer les à-nouveaux'}
          </button>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 12px' }}>Aucun à-nouveau enregistré pour ce dossier.</p>
      ))}

      <input type="file" accept=".csv,text/csv" onChange={choisir} disabled={enCours} />
      {enCours && <p className="muted">Lecture…</p>}
      {erreur && <p className="error-text">{erreur}</p>}

      {pasUneBalance && (
        <p className="error-text" style={{ marginTop: 12 }}>
          {nomFichier} ne ressemble pas à une balance : aucune colonne ne porte de numéro de compte du
          plan comptable. Ce n’est pas une balance vide — c’est probablement un autre document.
        </p>
      )}

      {lecture && controle && lecture.colonnes && (
        <div style={{ marginTop: 16 }}>
          {/* LE contrôle, en tête : une balance dont le débit ne boucle pas avec le crédit n'est pas
              une balance, c'est un fichier amputé — et c'est ce qu'il faut savoir avant tout le
              reste, pas après avoir parcouru deux cents lignes. */}
          <p style={{ margin: '0 0 8px' }}>
            {controle.equilibree ? (
              <span className="badge badge-ok">équilibrée</span>
            ) : (
              <span className="badge badge-danger">écart de {formatMoney(controle.ecart)}</span>
            )}{' '}
            {`${lecture.lignes.length} compte${lecture.lignes.length > 1 ? 's' : ''} `
              + `lu${lecture.lignes.length > 1 ? 's' : ''} — débit ${formatMoney(controle.totalDebit)}, `
              + `crédit ${formatMoney(controle.totalCredit)}.`}
          </p>
          {!controle.equilibree && (
            <p className="error-text" style={{ marginTop: 0 }}>
              Une balance est équilibrée par construction, toute écriture étant passée en partie
              double. Un écart dit que l’export ne contient pas tout : il faut le reprendre avant d’y
              adosser une comptabilité.
            </p>
          )}

          {/* Ce que l'application a COMPRIS du fichier. Sans ça, une colonne mal reconnue ne se voit
              qu'au total, c'est-à-dire trop tard et sans dire pourquoi. */}
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Colonnes retenues : compte n°{lecture.colonnes.compte + 1}, libellé n°
            {lecture.colonnes.libelle + 1}, débit n°{lecture.colonnes.debit + 1}, crédit n°
            {lecture.colonnes.credit + 1}.
          </p>

          <div className="table-scroll">
            <table>
              <thead><tr><th>Compte</th><th>Libellé</th><th>Débit</th><th>Crédit</th></tr></thead>
              <tbody>
                {lecture.lignes.map((l) => (
                  <tr key={l.compte}>
                    <td>{l.compte}</td>
                    <td>{l.libelle}</td>
                    <td>{l.debit ? formatMoney(l.debit) : ''}</td>
                    <td>{l.credit ? formatMoney(l.credit) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Jamais silencieusement : une ligne écartée sans motif se lit comme une ligne perdue, et
              c'est ce qui permet de diagnostiquer un en-tête pris pour un compte — ou l'inverse. */}
          {lecture.ignorees.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary>
                {`${lecture.ignorees.length} ligne${lecture.ignorees.length > 1 ? 's' : ''} `
                  + `écartée${lecture.ignorees.length > 1 ? 's' : ''}`}
              </summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {lecture.ignorees.map((i, n) => (
                  <li key={n} className="muted" style={{ fontSize: '0.85rem' }}>
                    {i.motif} — {i.ligne.filter((c) => c.trim()).join(' | ') || '(ligne vide)'}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {preparation && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--color-border)' }}>
              <h4 style={{ margin: '0 0 6px' }}>Ouvrir le dossier avec ces soldes</h4>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
                Seuls les comptes de bilan s’ouvrent. Le résultat de l’exercice précédent est repris en
                120 ou 129, en attente d’affectation : l’application ne décide pas de son affectation.
                Un compte de banque est repris sur le compte banque de l’application (512000).
              </p>
              <div className="field" style={{ maxWidth: 220 }}>
                <label htmlFor="an-exercice">Exercice ouvert</label>
                <select id="an-exercice" value={exercice} onChange={(e) => setExercice(Number(e.target.value))}>
                  {exercicesProposes.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              {preparation.refus ? (
                <p className="error-text">{preparation.refus}</p>
              ) : (
                <>
                  <p style={{ margin: '0 0 6px' }}>
                    {`${pluriel(preparation.lignes.length, 'à-nouveau', 'x')} au ${formatDate(dateOuverture(exercice))} `
                      + `— ${formatMoney(preparation.totalDebit)} au débit comme au crédit.`}
                  </p>
                  <ul style={{ margin: '0 0 8px', paddingLeft: 20, fontSize: '0.85rem' }}>
                    {preparation.resultat && (
                      <li>
                        {`${preparation.resultat.libelle} : ${formatMoney(preparation.resultat.montant)} `
                          + `au ${preparation.resultat.sens === 'credit' ? 'crédit' : 'débit'} du ${preparation.resultat.compte}.`}
                      </li>
                    )}
                    {preparation.rapproches.length > 0 && (
                      <li>
                        {'Repris sous un compte de l’application : '
                          + preparation.rapproches.map((r) => `${r.compteOrigine}${r.libelle ? ` ${r.libelle}` : ''} → ${r.compte}`).join(', ')
                          + '.'}
                      </li>
                    )}
                    {preparation.soldes > 0 && (
                      <li>{`${pluriel(preparation.soldes, 'compte')} de bilan soldé${preparation.soldes > 1 ? 's' : ''}, sans à-nouveau.`}</li>
                    )}
                    {preparation.classe8 > 0 && (
                      <li>{`${pluriel(preparation.classe8, 'compte')} de classe 8 écarté${preparation.classe8 > 1 ? 's' : ''} : hors bilan.`}</li>
                    )}
                  </ul>
                  <details style={{ marginBottom: 10 }}>
                    <summary>Voir ce qui sera écrit</summary>
                    <div className="table-scroll">
                      <table>
                        <thead><tr><th>Compte</th><th>Libellé</th><th>Débit</th><th>Crédit</th></tr></thead>
                        <tbody>
                          {preparation.lignes.map((l, n) => (
                            <tr key={n}>
                              <td>{l.compte}{l.compteOrigine && l.compteOrigine !== l.compte ? ` (${l.compteOrigine})` : ''}</td>
                              <td>{l.libelle}</td>
                              <td>{l.sens === 'debit' ? formatMoney(l.montant) : ''}</td>
                              <td>{l.sens === 'credit' ? formatMoney(l.montant) : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={enregistrer}
                    disabled={enregistrement || !empreinte || !ouvertureChargee || ouvertureIllisible !== null}
                  >
                    {enregistrement
                      ? 'Enregistrement…'
                      : ouverture.length > 0 ? 'Remplacer les à-nouveaux' : 'Enregistrer les à-nouveaux'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {erreurEnregistrement && <p className="error-text">{erreurEnregistrement}</p>}
      {confirmation && <p className="muted">{confirmation}</p>}
    </div>
  )
}
