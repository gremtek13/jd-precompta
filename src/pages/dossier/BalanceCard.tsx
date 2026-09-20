import { useState } from 'react'
import { controlerBalance, lireBalance, type ControleBalance, type ResultatLectureBalance } from '../../lib/balanceImport'
import { parseCsv } from '../../lib/csv'
import { formatMoney } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'

// L'écran qui manquait à `lib/balanceImport.ts` — module écrit, testé et décrit dans CLAUDE.md comme
// « la première brique de la reprise d'un dossier venu d'un autre logiciel », que RIEN n'importait.
//
// CE QU'IL FAIT, ET RIEN DE PLUS : il lit une balance et la CONTRÔLE. Il n'enregistre rien, et le dit
// à l'écran plutôt que de laisser croire qu'une reprise a eu lieu. Ce n'est pas une demi-mesure mais
// le périmètre du module (« ce module LIT et CONTRÔLE, il n'écrit rien ») : aucune table ne porte de
// balance reprise, et en inventer une sans savoir ce qu'elle doit alimenter — des à-nouveaux ? une
// comparaison avec la balance de l'application ? — serait deviner un choix produit.
//
// L'usage est complet tel quel, et c'est ce qui le rend livrable : « cet export de mon ancien
// logiciel est-il entier ? » se répond ici, AVANT d'adosser une comptabilité dessus. Même service que
// le contrôle de solde d'un relevé bancaire, sur un autre document.

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

export default function BalanceCard() {
  const [nomFichier, setNomFichier] = useState<string | null>(null)
  const [lecture, setLecture] = useState<ResultatLectureBalance | null>(null)
  const [controle, setControle] = useState<ControleBalance | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  async function choisir(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0]
    // Réinitialiser AVANT de lire : sans ça, un second fichier illisible laisserait à l'écran le
    // résultat du premier, sous le nom du second.
    setLecture(null)
    setControle(null)
    setErreur(null)
    setNomFichier(fichier?.name ?? null)
    e.target.value = ''
    if (!fichier) return

    setEnCours(true)
    try {
      const resultat = lireBalance(parseCsv(decoder(await fichier.arrayBuffer())))
      setLecture(resultat)
      setControle(controlerBalance(resultat.lignes))
    } catch (err) {
      setErreur(messageErreur(err, 'Ce fichier n’a pas pu être lu.'))
    } finally {
      setEnCours(false)
    }
  }

  // « Ce fichier n'est pas une balance » et « cette balance est vide » ne se disent pas pareil : un
  // relevé bancaire déposé par erreur rend `colonnes: null`, et l'annoncer comme une balance vide
  // enverrait chercher un défaut dans le fichier plutôt que dans le geste. Distinction portée par le
  // module ; l'écran ne doit pas la reperdre.
  const pasUneBalance = lecture !== null && lecture.colonnes === null

  return (
    <div className="card" style={{ maxWidth: 640, marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Balance d’un autre logiciel</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Dépose la balance générale exportée du logiciel précédent (CSV) pour vérifier qu’elle est
        entière avant de t’appuyer dessus. Les colonnes sont reconnues à leur contenu — la colonne des
        comptes est celle qui porte des numéros du plan comptable — et non à une mise en page
        supposée. <strong>Rien n’est enregistré</strong> : cet écran lit et contrôle, il ne reprend pas
        encore le dossier.
      </p>

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
        </div>
      )}
    </div>
  )
}
