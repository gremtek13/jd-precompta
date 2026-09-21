import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// UNE ÉCRITURE EN BASE EST VÉRIFIÉE, JAMAIS SUPPOSÉE RÉUSSIE — ET LE BALAYAGE DU 20/09/2026 S'ÉTAIT
// ARRÊTÉ À `src/`.
//
// La règle est ancienne dans ce projet (`supabase.from(...)` ne lève pas, l'erreur se lit dans
// `{ error }`), et elle avait été balayée sur trente sites de `src/` avec la question qui décide :
// *quelque chose recharge-t-il derrière ?* Là-bas, presque toujours oui — un `load()` suit, donc
// l'échec se voit, la ligne supprimée réapparaît.
//
// DANS UNE EDGE FUNCTION, LA RÉPONSE EST PRESQUE TOUJOURS NON, et c'est ce qui rend le même motif
// bien plus coûteux ici : rien ne recharge, l'appelant reçoit le code de retour que la fonction a
// décidé d'écrire, et une écriture ratée ne laisse AUCUNE trace. Les quatre sites trouvés le
// 21/09/2026 portaient tous sur une action déjà IRRÉVERSIBLE au moment de l'écriture — un e-mail
// parti chez le client, une facture transmise à une plateforme agréée DGFiP, un cabinet créé.
//
// Ce que ce test garde : qu'aucune écriture d'Edge Function ne reparte sans que son `{ error }` soit
// lu. Ce qu'il ne garde PAS, annoncé plutôt que laissé deviner : ce qu'on FAIT de cette erreur.
// Journaliser, remonter à l'appelant ou compenser est un arbitrage par site — le test exige
// seulement qu'elle ne soit pas jetée.
//
// Il part de TOUTES les fonctions, comme `rls.sql` part de `pg_class` : une Edge Function ajoutée
// demain est examinée sans que personne ait à y penser.
//
// ET IL NE REGARDAIT QU'UNE PORTE SUR QUATRE (corrigé le 21/09/2026). Sa première version ne
// cherchait que `.from(` — la seule forme des quatre sites trouvés ce jour-là. Or un client Supabase
// écrit aussi par `.rpc(`, par `.auth.admin.` et par `.storage.`, et le balayage sur ces trois
// portes a rendu TROIS sites de plus, dont le plus coûteux de toute la famille : le mot de passe
// d'un compte réutilisé, POSÉ SANS QU'ON LISE LE RÉSULTAT, sur une fonction qui répondait ensuite
// `ok: true`. Le cabinet communiquait alors au client un mot de passe qui n'avait jamais été posé,
// et le symptôme — « je n'arrive pas à me connecter » — ressemble à une erreur du client.
// C'est la panne que ce dépôt connaît sous un autre nom : **une liste d'inclusion tenue à la main ne
// contient que ce à quoi quelqu'un a pensé**, et son silence est indiscernable d'un dépôt sain.

/**
 * Les écritures dont le résultat n'a PAS à être lu, avec la raison.
 *
 * Vide à ce jour. Une entrée ici doit expliquer pourquoi l'échec de CETTE écriture ne coûte rien —
 * pas « c'est best-effort » (un best-effort se journalise, il ne se tait pas), mais « quelque chose
 * derrière le rattrape, et voici quoi ».
 */
const EXCEPTIONS: Record<string, string> = {}

function fonctions(): string[] {
  const racine = new URL('../../supabase/functions/', import.meta.url)
  return readdirSync(racine, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

function sourceDe(fonction: string): string {
  return readFileSync(new URL(`../../supabase/functions/${fonction}/index.ts`, import.meta.url), 'utf8')
}

/**
 * Les quatre portes d'écriture d'un client Supabase, en début d'instruction.
 *
 * `.from` et `.rpc` prennent leur parenthèse — ce sont des appels ; `.auth` et `.storage` sont des
 * sous-objets, donc bornés par `\b`, pour que `await admin.auth.admin.updateUserById(…)` et
 * `await supabase.storage.from("pieces").remove([…])` tombent dedans.
 */
const PORTES = /^\s*await\s+[A-Za-z_$][\w$]*\s*\.\s*(?:(?:from|rpc)\s*\(|(?:auth|storage)\b)/

export interface EcritureNonVerifiee {
  fonction: string
  ligne: number
  extrait: string
}

/**
 * Les écritures Supabase dont le résultat part à la poubelle.
 *
 * On cherche un `await <client>.<porte>` en DÉBUT D'INSTRUCTION — donc précédé ni d'une
 * destructuration (`const { error } = await …`), ni d'une affectation, ni d'un `return`. C'est
 * volontairement syntaxique et volontairement fragile : reformater l'appel casse le test
 * bruyamment, ce qui vaut mieux qu'une écriture qui redevient muette en silence.
 *
 * LES QUATRE PORTES du client Supabase, et pas seulement la première :
 * - `.from(`    — les tables (PostgREST) ;
 * - `.rpc(`     — les fonctions SQL, qui écrivent aussi (voir `enregistrer_facture`) ;
 * - `.auth.`    — les comptes : création, mot de passe, suppression ;
 * - `.storage.` — les fichiers, dont le retrait d'un orphelin.
 * En omettre une revient à déclarer sain ce qu'on n'a pas regardé.
 *
 * Les LECTURES sont écartées par leur forme : une lecture est toujours destructurée (`const { data }
 * = await …`), sinon elle ne sert à rien. Ce qui reste après ce filtre est donc, par construction,
 * une écriture — ou une lecture dont on jette le résultat, qui mérite le même signalement.
 */
export function ecrituresNonVerifiees(fonction: string, source: string): EcritureNonVerifiee[] {
  const trouvees: EcritureNonVerifiee[] = []
  source.split('\n').forEach((ligne, index) => {
    // Ni `= await`, ni `return await`, ni `} = await` : seul un résultat JETÉ nous intéresse.
    if (!PORTES.test(ligne)) return
    if (EXCEPTIONS[`${fonction}:${index + 1}`]) return
    trouvees.push({ fonction, ligne: index + 1, extrait: ligne.trim().slice(0, 100) })
  })
  return trouvees
}

describe('les écritures des Edge Functions lisent leur erreur', () => {
  const toutes = fonctions()

  it('parcourt bien toutes les fonctions déployables', () => {
    // Sans cette borne, un scanner qui ne lirait plus rien annoncerait « zéro faute » — la panne qui
    // ressemble exactement au succès, et que ce dépôt a déjà payée plusieurs fois.
    expect(toutes.length).toBeGreaterThanOrEqual(12)
    expect(toutes).toContain('send-email')
    expect(toutes).toContain('create-cabinet')
    expect(toutes).toContain('superpdp-emit')
  })

  it('trouve bien des écritures à examiner — sinon il ne garderait rien', () => {
    // La borne symétrique : le motif `.from(` doit exister en nombre dans ces sources, sans quoi
    // « aucune écriture en faute » voudrait seulement dire « aucune écriture vue ».
    const total = toutes.reduce((n, f) => n + (sourceDe(f).match(/\.\s*from\s*\(/g)?.length ?? 0), 0)
    expect(total).toBeGreaterThan(20)
  })

  it('n’en laisse aucune jeter son erreur', () => {
    const fautes = toutes.flatMap((f) => ecrituresNonVerifiees(f, sourceDe(f)))
    expect(
      fautes.map((f) => `${f.fonction}:${f.ligne} — ${f.extrait}`).join('\n'),
      'dans une Edge Function rien ne recharge derrière : une écriture ratée ne laisse aucune trace',
    ).toBe('')
  })
})

describe('le scanner lui-même — défaut PLANTÉ, pas espéré', () => {
  // « Le scanner rend zéro » et « le scanner est aveugle » se ressemblent trop : on lui donne donc
  // une source SYNTHÉTIQUE portant le défaut dans sa forme exacte, plus les cas voisins qu'il ne
  // doit PAS attraper.
  const fautif = `
    const { data: sent } = await resend.emails.send({})
    await admin.from("emails_envoyes").insert({ resend_id: sent?.id })
  `
  const correct = `
    const { error: erreurJournal } = await admin.from("emails_envoyes").insert({})
    if (erreurJournal) console.error(erreurJournal.message)
  `
  const lecture = `
    const { data, error } = await admin.from("pieces").select("id")
  `
  // Une écriture dont on ATTEND la valeur de retour est déjà destructurée autrement — elle ne doit
  // pas être signalée, sinon le scanner crierait au loup sur la forme la plus sûre qui soit.
  const affectee = `
    const resultat = await admin.from("pieces").insert({})
  `
  // LES TROIS AUTRES PORTES, une par une. Sans ces cas, réduire `PORTES` à `.from(` — c'est-à-dire
  // replanter le défaut du 21/09/2026 — laisserait TOUT ce bloc au vert.
  const parRpc = `
    await admin.rpc("enregistrer_facture", { p_dossier_id: dossierId })
  `
  const parAuth = `
    await admin.auth.admin.updateUserById(userId, { password })
  `
  const parStorage = `
    await supabase.storage.from("pieces").remove([path])
  `

  it('attrape une écriture dont le résultat part à la poubelle', () => {
    expect(ecrituresNonVerifiees('synthetique', fautif)).toEqual([
      { fonction: 'synthetique', ligne: 3, extrait: 'await admin.from("emails_envoyes").insert({ resend_id: sent?.id })' },
    ])
  })

  it('ne crie pas au loup sur une écriture vérifiée', () => {
    expect(ecrituresNonVerifiees('synthetique', correct)).toEqual([])
  })

  it('laisse passer une lecture, qui est destructurée par nature', () => {
    expect(ecrituresNonVerifiees('synthetique', lecture)).toEqual([])
  })

  it('laisse passer une écriture dont le résultat est affecté', () => {
    expect(ecrituresNonVerifiees('synthetique', affectee)).toEqual([])
  })

  it('attrape une écriture passée par .rpc(', () => {
    expect(ecrituresNonVerifiees('synthetique', parRpc)).toHaveLength(1)
  })

  it('attrape une écriture passée par .auth. — le mot de passe d’un compte réutilisé', () => {
    expect(ecrituresNonVerifiees('synthetique', parAuth)).toHaveLength(1)
  })

  it('attrape un retrait de fichier passé par .storage.', () => {
    // Celle-ci est la plus facile à croire inoffensive : c'est une SUPPRESSION, donc « au pire il ne
    // se passe rien ». Au pire il reste un fichier que plus aucun écran ne peut montrer.
    expect(ecrituresNonVerifiees('synthetique', parStorage)).toHaveLength(1)
  })

  it('distingue bien les deux issues — sinon il ne prouverait rien', () => {
    // Un scanner qui rendrait TOUT en faute passerait les cas ci-dessus sans rien valoir.
    expect(ecrituresNonVerifiees('s', fautif + correct + lecture + affectee)).toHaveLength(1)
    // Et les quatre portes ensemble : quatre fautes, pas une de plus ni une de moins.
    expect(ecrituresNonVerifiees('s', fautif + parRpc + parAuth + parStorage + correct + lecture + affectee)).toHaveLength(4)
  })

  it('n’admet que des exceptions qui correspondent à une écriture RÉELLE', () => {
    // Sans ce contrôle, la liste se remplirait de raisons mortes — une exception laissée après le
    // déplacement de la ligne qu'elle dispensait, et personne pour s'en apercevoir.
    for (const cle of Object.keys(EXCEPTIONS)) {
      const [fonction, ligne] = cle.split(':')
      const source = sourceDe(fonction).split('\n')[Number(ligne) - 1] ?? ''
      expect(source, `exception morte : ${cle}`).toMatch(PORTES)
    }
  })
})
