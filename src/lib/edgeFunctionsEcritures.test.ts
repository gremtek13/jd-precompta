import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// UNE ÉCRITURE EN BASE EST VÉRIFIÉE, JAMAIS SUPPOSÉE RÉUSSIE — ET CE SCANNER NE VOYAIT QU'UNE FORME
// SUR SIX.
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
// ET IL NE REGARDAIT QU'UNE PORTE SUR QUATRE (corrigé le 21/09/2026). Sa première version ne
// cherchait que les tables — la seule forme des quatre sites trouvés ce jour-là. Or un client
// Supabase écrit aussi par les fonctions SQL, par les comptes et par les fichiers, et le balayage
// sur ces trois portes a rendu TROIS sites de plus, dont le plus coûteux de toute la famille : le
// mot de passe d'un compte réutilisé, POSÉ SANS QU'ON LISE LE RÉSULTAT, sur une fonction qui
// répondait ensuite `ok: true`. Le cabinet communiquait alors au client un mot de passe qui n'avait
// jamais été posé, et le symptôme — « je n'arrive pas à me connecter » — ressemble à une erreur du
// client.
//
// ET LE 22/09/2026, C'EST SA LECTURE « PAR LIGNE » QUI A CÉDÉ — SEPTIÈME FOIS QUE CE DÉPÔT SE FAIT
// PRENDRE PAR UN RETOUR À LA LIGNE, et cette fois sur mon propre travail de la veille : le scanner
// des LECTURES venait d'être étendu à la forme sans `await`, et son frère est resté derrière. Le
// motif exigeait `await <client>.<porte>` sur UNE SEULE LIGNE, alors que six écritures de ces
// fonctions sont formatées en chaîne multi-ligne — le formatage normal de ce dépôt :
//
//     const { error: insertError } = await admin
//       .from("cabinet_admins")
//       .insert({ … })
//
// MESURÉ PAR MUTATION, jamais supposé : retirer la destructuration de CETTE écriture-là — la
// compensation qui répare un cabinet à moitié créé — laissait les douze tests au VERT. Cinq formes
// sur six étaient aveugles (multi-ligne, entrée de `Promise.all`, `.then(`, promesse flottante,
// `void`) ; seule la forme d'une ligne était vue.
//
// LA RÉPARATION EST CELLE DE `lecturesVerifiees` : on ne lit plus « la ligne », on REMONTE les
// enveloppes transparentes (`await`, `void`) jusqu'au caractère qui dit si le résultat est CONSOMMÉ.
// Un résultat lié — destructuré, affecté, rendu, passé en argument, branche de ternaire — sort du
// champ de ce test : c'est alors au scanner des LECTURES de vérifier qu'il porte bien `error`.
// Ce qui reste est une expression dont personne ne prend le résultat, et il n'existe aucune raison
// d'écrire cela contre une base.
//
// AUCUNE FAUTE VIVANTE DERRIÈRE CE TROU, et c'est dit plutôt que gonflé : les trente-deux écritures
// de ces fonctions lisent toutes leur erreur aujourd'hui. Ce qui justifie l'élargissement n'est donc
// pas une prise mais la mutation ci-dessus — la prochaine écriture écrite dans le formatage normal
// du dépôt serait passée sans un mot.
//
// Ce que ce test garde : qu'aucune écriture d'Edge Function ne reparte sans que son résultat soit
// pris. Ce qu'il ne garde PAS, annoncé plutôt que laissé deviner : ce qu'on FAIT de l'erreur.
// Journaliser, remonter à l'appelant ou compenser est un arbitrage par site.
//
// Il part de TOUTES les fonctions, comme `rls.sql` part de `pg_class` : une Edge Function ajoutée
// demain est examinée sans que personne ait à y penser.

/**
 * Les écritures dont le résultat n'a PAS à être pris, avec la raison ET LE NOMBRE.
 *
 * Vide à ce jour. Une entrée ici doit expliquer pourquoi l'échec de CETTE écriture ne coûte rien —
 * pas « c'est best-effort » (un best-effort se journalise, il ne se tait pas), mais « quelque chose
 * derrière le rattrape, et voici quoi ».
 *
 * LE NOMBRE FAIT PARTIE DE L'EXCEPTION, comme dans `edgeFunctionsLectures` et `datesUtc` : dispenser
 * une FONCTION dispense tout son fichier, or ces fonctions portent des dizaines d'écritures. Une de
 * plus est une rechute, une de moins est une raison morte.
 */
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {}

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
 * Voir `retraitsStockage.test.ts` : ce dépôt CITE ses défauts dans ses commentaires, et l'en-tête
 * ci-dessus en est l'exemple. On ne coupe QUE les lignes entièrement en commentaire — jamais un
 * commentaire de fin de ligne, le code fautif étant de toute façon avant le `//`.
 */
function sansCommentairesPleins(texte: string): string {
  return texte
    .split('\n')
    .map((l) => (l.trimStart().startsWith('//') || l.trimStart().startsWith('*') ? '' : l))
    .join('\n')
}

/**
 * Les quatre portes d'écriture d'un client Supabase, et LE CLIENT N'EST PAS NOMMÉ.
 *
 * Ces fonctions appellent leur client `admin`, `supabase` ou `supabaseAsCaller` selon qu'elles
 * portent la clé de service ou le JWT de l'appelant. Ancrer sur un nom précis, c'est rater la
 * prochaine qui en choisira un autre — la panne de la liste d'inclusion, encore.
 *
 * - les tables (`from`) ;
 * - les fonctions SQL (`rpc`), qui écrivent aussi — voir `enregistrer_facture` ;
 * - les comptes (`auth`) : création, mot de passe, suppression ;
 * - les fichiers (`storage`), dont le retrait d'un orphelin.
 *
 * Les `\s*` traversent les retours à la ligne, et c'est tout l'objet de la correction du 22/09/2026 :
 * `await admin\n  .from("x")\n  .insert({})` est UNE expression, pas trois lignes.
 */
const PORTES = String.raw`[A-Za-z_$][\w$]*\s*\.\s*(?:(?:from|rpc)\s*\(|(?:auth|storage)\b)`

export interface EcritureNonVerifiee {
  fonction: string
  ligne: number
  extrait: string
}

const ligneDe = (code: string, index: number) => code.slice(0, index).split('\n').length

/** L'extrait lisible d'un site, sur une ligne, pour que le message d'échec DÉSIGNE le code. */
function extraitDe(code: string, index: number): string {
  return code.slice(index, index + 100).split('\n').map((l) => l.trim()).join(' ').slice(0, 100)
}

/**
 * Remonte les enveloppes TRANSPARENTES devant `depart` — espaces, `await`, `void` — et rend l'index
 * du premier caractère signifiant, ou -1 s'il n'y en a pas.
 *
 * `void` est là parce que c'est la façon la plus explicite de dire « je ne veux pas savoir », au
 * même titre que le `.catch(() => {})` qu'interdit `retraitsStockage.test.ts`.
 */
function caractereAmont(code: string, depart: number): number {
  let i = depart - 1
  for (;;) {
    while (i >= 0 && /\s/.test(code[i])) i--
    if (i < 0) return -1
    const mot = /\b(await|void)$/.exec(code.slice(0, i + 1))
    if (mot && mot.index + mot[0].length === i + 1) { i = mot.index - 1; continue }
    return i
  }
}

/**
 * La TÊTE de la chaîne dont `depart` est un maillon.
 *
 * `admin.from(…)` est sa propre tête, mais un client atteint par une propriété — `deps.admin.from(…)`
 * — ne l'est pas, et c'est ce qui décide : la question « le résultat est-il pris ? » se pose à la
 * tête de l'expression, jamais au milieu. La première version de ce scanner SAUTAIT tout maillon
 * précédé d'un point ; elle rendait donc aveugle exactement cette forme-là, dans le seul sens
 * dangereux. Trouvé parce que la mutation censée garder cette règle a SURVÉCU : le drapeau `g`
 * consomme déjà le jeton `storage` de `supabase.storage.from(…)`, donc la règle ne protégeait de
 * rien et coûtait un angle mort.
 */
function teteDeChaine(code: string, depart: number): number {
  let tete = depart
  for (;;) {
    const i = caractereAmont(code, tete)
    if (i < 0 || code[i] !== '.') return tete
    let j = i - 1
    while (j >= 0 && /\s/.test(code[j])) j--
    // Pas un identifiant simple devant le point (un appel, un littéral…) : on s'arrête là.
    if (j < 0 || !/[\w$]/.test(code[j])) return tete
    while (j >= 0 && /[\w$]/.test(code[j])) j--
    tete = j + 1
  }
}

/**
 * Le résultat de l'expression dont la tête est `depart` est-il PRIS par quelqu'un ?
 *
 * Pris : destructuré ou affecté (`=`), rendu (`return`/`yield`), corps d'une flèche (`=>`), passé en
 * argument ou entre parenthèses (`(`), élément d'un tableau (`[`, `,`), branche de ternaire ou
 * valeur d'une propriété (`?`, `:`). Dans tous ces cas l'erreur reste ATTEIGNABLE, et c'est alors au
 * scanner des LECTURES de vérifier qu'on la prend vraiment — deux tests, deux questions.
 *
 * Tout le reste — début d'instruction, `{`, `}`, `;`, la parenthèse d'un `if (…)` — est un résultat
 * jeté. Une forme non prévue tombe donc du côté SIGNALÉ, jamais du côté silencieux : c'est la règle
 * de `recherchesEtTotaux`, sans laquelle « zéro faute » et « aveugle » redeviennent indiscernables.
 */
function resultatPris(code: string, depart: number): boolean {
  const i = caractereAmont(code, depart)
  if (i < 0) return false
  const c = code[i]
  if (c === '=') return true
  if (c === '>' && code[i - 1] === '=') return true
  if (c === '(' || c === '[' || c === ',' || c === '?' || c === ':') return true
  return /\b(return|yield)$/.test(code.slice(0, i + 1))
}

/**
 * PORTE 1 — l'expression dont personne ne prend le résultat, quel que soit son formatage.
 *
 * Les sites sont repérés par leur TÊTE : deux ancres d'une même chaîne désignent alors le même site,
 * et un scanner qui compte double finit par ne plus être lu.
 */
function ecrituresNues(code: string): number[] {
  const sites: number[] = []
  const motif = new RegExp(PORTES, 'g')
  let trouve: RegExpExecArray | null
  while ((trouve = motif.exec(code)) !== null) {
    const tete = teteDeChaine(code, trouve.index)
    if (!resultatPris(code, tete)) sites.push(tete)
  }
  return sites
}

/**
 * PORTE 2 — `await Promise.all([ … ])` dont le tableau de résultats part à la poubelle.
 *
 * Porte séparée pour la même raison que dans `edgeFunctionsLectures` : une entrée de tableau est
 * « prise » au sens de la porte 1 (son résultat entre dans le tableau), et c'est le SORT DU TABLEAU
 * qui décide. Lié, chaque entrée redevient l'affaire du scanner des lectures ; jeté, toutes les
 * erreurs du lot partent avec lui.
 */
function promiseAllJetes(code: string): number[] {
  const sites: number[] = []
  const motif = /\bPromise\s*\.\s*(?:all|allSettled)\s*\(\s*\[/g
  let trouve: RegExpExecArray | null
  while ((trouve = motif.exec(code)) !== null) {
    if (resultatPris(code, trouve.index) !== false) continue
    let profondeur = 0
    let fin = code.length
    for (let i = trouve.index + trouve[0].length - 1; i < code.length; i++) {
      if (code[i] === '[') profondeur++
      else if (code[i] === ']') { profondeur--; if (profondeur === 0) { fin = i; break } }
    }
    const tableau = code.slice(trouve.index, fin)
    const interne = new RegExp(PORTES, 'g')
    let ancre: RegExpExecArray | null
    while ((ancre = interne.exec(tableau)) !== null) {
      sites.push(trouve.index + teteDeChaine(tableau, ancre.index))
    }
  }
  return sites
}

/**
 * Les écritures Supabase dont le résultat part à la poubelle.
 *
 * Volontairement syntaxique : reformater un appel peut casser ce test bruyamment, ce qui vaut mieux
 * qu'une écriture qui redevient muette en silence. Les LECTURES s'écartent d'elles-mêmes par leur
 * forme — une lecture est toujours destructurée, sinon elle ne sert à rien — donc ce qui reste après
 * ce filtre est une écriture, ou une lecture dont on jette le résultat, qui mérite le même
 * signalement.
 */
export function ecrituresNonVerifiees(fonction: string, source: string): EcritureNonVerifiee[] {
  const code = sansCommentairesPleins(source)
  const sites = [...new Set([...ecrituresNues(code), ...promiseAllJetes(code)])].sort((a, b) => a - b)
  const dispense = EXCEPTIONS[fonction]?.nombre ?? 0
  return sites
    .slice(dispense)
    .map((index) => ({ fonction, ligne: ligneDe(code, index), extrait: extraitDe(code, index) }))
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
    // La borne symétrique : les portes doivent exister en nombre dans ces sources, sans quoi
    // « aucune écriture en faute » voudrait seulement dire « aucune écriture vue ».
    const total = toutes.reduce((n, f) => n + (sourceDe(f).match(new RegExp(PORTES, 'g'))?.length ?? 0), 0)
    expect(total).toBeGreaterThan(40)
  })

  it('n’en laisse aucune jeter son erreur', () => {
    const fautes = toutes.flatMap((f) => ecrituresNonVerifiees(f, sourceDe(f)))
    expect(
      fautes.map((f) => `${f.fonction}:${f.ligne} — ${f.extrait}`).join('\n'),
      'dans une Edge Function rien ne recharge derrière : une écriture ratée ne laisse aucune trace',
    ).toBe('')
  })

  it('n’admet que des exceptions qui correspondent à un nombre RÉEL de sites', () => {
    // Sans ce contrôle, la liste se remplirait de raisons mortes — une exception laissée après la
    // correction du site qu'elle dispensait, et personne pour s'en apercevoir.
    for (const [fonction, { nombre }] of Object.entries(EXCEPTIONS)) {
      const code = sansCommentairesPleins(sourceDe(fonction))
      const sites = new Set([...ecrituresNues(code), ...promiseAllJetes(code)])
      expect(sites.size, `exception morte ou sous-évaluée : ${fonction}`).toBe(nombre)
    }
  })
})

describe('le scanner lui-même — défauts PLANTÉS, pas espérés', () => {
  // « Le scanner rend zéro » et « le scanner est aveugle » se ressemblent trop : on lui donne donc
  // des sources SYNTHÉTIQUES portant le défaut dans sa forme exacte, plus les cas voisins qu'il ne
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
  // Une écriture dont on ATTEND la valeur de retour est déjà prise autrement — elle ne doit pas être
  // signalée, sinon le scanner crierait au loup sur la forme la plus sûre qui soit.
  const affectee = `
    const resultat = await admin.from("pieces").insert({})
  `
  // LES TROIS AUTRES PORTES, une par une. Sans ces cas, réduire `PORTES` aux seules tables — c'est
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
  // LES CINQ FORMES QUE LA LECTURE « PAR LIGNE » NE VOYAIT PAS (22/09/2026).
  const multiLigne = `
    await admin
      .from("cabinet_admins")
      .insert({ user_id: userId })
  `
  const multiLigneCorrect = `
    const { error: insertError } = await admin
      .from("cabinet_admins")
      .insert({ user_id: userId })
    if (insertError) return json({ error: insertError.message }, 500)
  `
  const promesseFlottante = `
    admin.from("emails_envoyes").insert({ resend_id: id })
  `
  const parVoid = `
    void admin.from("emails_envoyes").insert({ resend_id: id })
  `
  const parThen = `
    admin.from("emails_envoyes").insert({ resend_id: id }).then(() => {})
  `
  const promiseAllJete = `
    await Promise.all([
      admin.from("a").insert({}),
      admin.from("b").insert({}),
    ])
  `
  const promiseAllLie = `
    const [a, b] = await Promise.all([
      admin.from("a").insert({}),
      admin.from("b").insert({}),
    ])
    if (a.error || b.error) return json({ error: "échec" }, 500)
  `
  // Le ternaire de `receive-email` : les DEUX branches sont awaitées et leur `.error` est pris juste
  // après. C'est la forme qui rendait 75 % de faux positifs au détecteur de `src/`.
  const ternaire = `
    const insertError = estPiece
      ? (await supabase.from("pieces").insert({})).error
      : (await supabase.from("documents_divers").insert({})).error
    if (insertError) return json({ error: insertError.message }, 500)
  `
  // UN CLIENT ATTEINT PAR UNE PROPRIÉTÉ — la forme que la règle du « maillon » rendait aveugle.
  // Aucune de ces fonctions ne l'écrit ainsi aujourd'hui (le client est toujours un identifiant nu),
  // et c'est justement pourquoi le cas est SYNTHÉTIQUE : le jour où l'une le fera, la question
  // « le résultat est-il pris ? » doit se poser à la tête de la chaîne, pas au milieu.
  const clientParPropriete = `
    await deps.admin.from("emails_envoyes").insert({ resend_id: id })
  `
  const clientParProprieteCorrect = `
    const { error } = await deps.admin.from("emails_envoyes").insert({ resend_id: id })
    if (error) console.error(error.message)
  `
  // Le constructeur de requête d'agent-comptable : la tête est affectée, la suite est awaitée
  // ailleurs et lue là-bas.
  const constructeur = `
    let q = admin.from("ecritures_brouillon").select("compte").eq("dossier_id", dossierId)
    if (debut) q = q.gte("date", debut)
    const { data, error } = await q
  `

  it('attrape une écriture dont le résultat part à la poubelle', () => {
    expect(ecrituresNonVerifiees('synthetique', fautif)).toHaveLength(1)
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

  it('attrape une écriture passée par les fonctions SQL', () => {
    expect(ecrituresNonVerifiees('synthetique', parRpc)).toHaveLength(1)
  })

  it('attrape une écriture passée par les comptes — le mot de passe d’un compte réutilisé', () => {
    expect(ecrituresNonVerifiees('synthetique', parAuth)).toHaveLength(1)
  })

  it('attrape un retrait de fichier passé par le stockage, et ne le compte qu’UNE fois', () => {
    // Celle-ci est la plus facile à croire inoffensive : c'est une SUPPRESSION, donc « au pire il ne
    // se passe rien ». Au pire il reste un fichier que plus aucun écran ne peut montrer.
    // Et elle porte DEUX ancres (`.storage` puis `.from(`) : sans la règle du maillon, le même site
    // serait annoncé deux fois, et un scanner qui compte double finit par ne plus être lu.
    expect(ecrituresNonVerifiees('synthetique', parStorage)).toHaveLength(1)
  })

  it('attrape la chaîne MULTI-LIGNE — le formatage normal de ce dépôt', () => {
    // Le défaut du 22/09/2026, replanté dans sa forme exacte : six écritures réelles sont écrites
    // ainsi, et la lecture « par ligne » les rendait toutes invisibles.
    expect(ecrituresNonVerifiees('synthetique', multiLigne)).toHaveLength(1)
  })

  it('ne crie pas au loup sur la même chaîne multi-ligne quand elle est vérifiée', () => {
    expect(ecrituresNonVerifiees('synthetique', multiLigneCorrect)).toEqual([])
  })

  it('attrape une promesse flottante, un `void` et un `.then(`', () => {
    // Les trois façons de dire « je ne veux pas savoir » — dont deux ne sont même pas attendues,
    // donc la fonction peut répondre avant que l'écriture ait eu lieu.
    expect(ecrituresNonVerifiees('synthetique', promesseFlottante)).toHaveLength(1)
    expect(ecrituresNonVerifiees('synthetique', parVoid)).toHaveLength(1)
    expect(ecrituresNonVerifiees('synthetique', parThen)).toHaveLength(1)
  })

  it('attrape les entrées d’un Promise.all dont le tableau est jeté', () => {
    expect(ecrituresNonVerifiees('synthetique', promiseAllJete)).toHaveLength(2)
  })

  it('laisse passer un Promise.all dont le tableau est lié', () => {
    expect(ecrituresNonVerifiees('synthetique', promiseAllLie)).toEqual([])
  })

  it('laisse passer un ternaire dont les deux branches sont prises', () => {
    expect(ecrituresNonVerifiees('synthetique', ternaire)).toEqual([])
  })

  it('laisse passer un constructeur de requête awaité ailleurs', () => {
    expect(ecrituresNonVerifiees('synthetique', constructeur)).toEqual([])
  })

  it('remonte à la TÊTE de la chaîne quand le client est atteint par une propriété', () => {
    // Les deux sens, et il faut les deux : sans le premier, la remontée peut disparaître sans qu'on
    // le voie ; sans le second, elle peut se mettre à crier au loup sur la forme correcte.
    expect(ecrituresNonVerifiees('synthetique', clientParPropriete)).toHaveLength(1)
    expect(ecrituresNonVerifiees('synthetique', clientParProprieteCorrect)).toEqual([])
  })

  it('ne voit rien dans une ligne entièrement en commentaire', () => {
    // Ce fichier CITE ses défauts : sans ce filtrage, son propre en-tête le ferait échouer.
    expect(ecrituresNonVerifiees('synthetique', '    // await admin.from("x").insert({})\n')).toEqual([])
  })

  it('distingue bien les deux issues — sinon il ne prouverait rien', () => {
    // Un scanner qui rendrait TOUT en faute passerait les cas ci-dessus sans rien valoir.
    expect(ecrituresNonVerifiees('s', fautif + correct + lecture + affectee)).toHaveLength(1)
    // Les quatre portes et les cinq formes ensemble : le compte exact, pas une de plus ni une de
    // moins.
    const tout = fautif + parRpc + parAuth + parStorage + multiLigne + promesseFlottante
      + parVoid + parThen + promiseAllJete + clientParPropriete + correct + multiLigneCorrect
      + promiseAllLie + lecture + affectee + ternaire + constructeur + clientParProprieteCorrect
    expect(ecrituresNonVerifiees('s', tout)).toHaveLength(11)
  })
})
