import { readdirSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { CONTRATS, DEFAUTS_CONNUS, jugerScenario, type ContratFonction, type Contexte } from '../test/contratsFonctions'
import { CLE_PUBLIABLE, URL_PROJET, muter, prechauffer, slugsDesFonctions, sourceDe } from '../test/fonctionsEdge'

// LES EDGE FUNCTIONS APPELÉES EN HTTP, DANS LA SUITE (ligne 23 de la feuille de route).
//
// Chaque fonction de `supabase/functions/` est chargée depuis sa vraie source par le harnais (`src/test/fonctionsEdge.ts`)
// et jouée contre ses contrats (`src/test/contratsFonctions.ts`) : le préflight du navigateur, les refus sans session ou
// d'un appelant qui n'a pas le droit — et AUCUNE dépense avant eux —, les corps mal formés, les plafonds, la fenêtre
// datée, la signature d'un webhook, ce qui ne doit jamais revenir (un secret, une valeur de pièce dans un journal).
// Sans réseau, sans secret, sans appel facturé : ce que la CI ne pouvait pas faire contre les fonctions DÉPLOYÉES, elle
// le fait ici contre leur source.
//
// Trois couches, comme partout dans ce dépôt :
//   - le garde part de TOUT : chaque dossier de `supabase/functions/` a son contrat, les fonctions que la page appelle
//     se LISENT dans `src/` (et non dans une liste), une exception porte sa raison et son nombre, un plancher dit
//     qu'on n'est pas devenu aveugle ;
//   - chaque scénario se joue, et rend la liste de ses fautes — vide sur la vraie source ;
//   - des défauts PLANTÉS dans la vraie source, en mémoire, prouvent que les juges voient ce qu'ils gardent. La campagne
//     de mutations complète (le rapport de la ligne 23) en joue bien davantage, sur des copies, jamais sur le fichier
//     servi pendant la suite.

/** Les fonctions que la page n'appelle pas, et pourquoi elles n'ont pas de préflight à tenir. */
const HORS_DU_NAVIGATEUR: Record<string, string> = {
  'receive-email': 'webhook de Resend, appelé de serveur à serveur, signé par Svix',
  'evaluer-extraction': 'harnais de mesure, appelé à la main (curl), derrière la seule clé publishable',
}

// ── CE QUE LE SDK DU NAVIGATEUR ENVOIE ───────────────────────────────────────────────────────────────────────────────
// Mesuré, pas recopié : le vrai `@supabase/supabase-js` de l'application appelle une fonction devant un `fetch` qui
// relève ses en-têtes. Un en-tête que le SDK ajouterait demain entre dans le préflight de chaque fonction, et une
// fonction qui ne l'admet pas tombe ici avant de tomber chez le cabinet. Le jeton d'accès est celui d'une page connectée.
// Les en-têtes que le navigateur n'a pas à demander (« CORS-safelisted » : Accept, Accept-Language, Content-Language)
// sont écartés ; Content-Type n'en est pas un ici, il vaut application/json.
const EN_TETES_SURS = new Set(['accept', 'accept-language', 'content-language'])

async function entetesDuSdk(): Promise<string[]> {
  const relevees: Headers[] = []
  const client = createClient(URL_PROJET, CLE_PUBLIABLE, {
    accessToken: async () => 'jeton-de-session-de-la-page',
    global: {
      fetch: async (_entree: RequestInfo | URL, init?: RequestInit) => {
        relevees.push(new Headers(init?.headers))
        return Response.json({ ok: true })
      },
    },
  })
  const { error } = await client.functions.invoke('fonction-du-harnais', { body: { essai: true } })
  expect(error).toBeNull()
  expect(relevees).toHaveLength(1)
  return [...relevees[0].keys()].map((n) => n.toLowerCase()).filter((n) => !EN_TETES_SURS.has(n)).sort()
}

const contexte: Contexte = { entetesDuNavigateur: [] }
beforeAll(async () => {
  contexte.entetesDuNavigateur = await entetesDuSdk()
})

// ── LES FONCTIONS QUE LA PAGE APPELLE, LUES DANS `src/` ──────────────────────────────────────────────────────────────

function sourcesDeLaPage(): { chemin: string; texte: string }[] {
  const racine = new URL('../', import.meta.url)
  const trouves: { chemin: string; texte: string }[] = []
  const parcourir = (dossier: URL, prefixe: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (entree.name === 'test') continue
      const suivant = new URL(`${entree.name}${entree.isDirectory() ? '/' : ''}`, dossier)
      if (entree.isDirectory()) { parcourir(suivant, `${prefixe}${entree.name}/`); continue }
      if (!/\.tsx?$/.test(entree.name) || /\.test\.tsx?$/.test(entree.name)) continue
      trouves.push({ chemin: `${prefixe}${entree.name}`, texte: readFileSync(suivant, 'utf8') })
    }
  }
  parcourir(racine, 'src/')
  return trouves
}

/** Retire les lignes entièrement en commentaire : ce dépôt cite ses appels dans ses explications. */
const sansCommentaires = (texte: string) =>
  texte.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n')

/**
 * Le nom de chaque fonction qu'un `functions.invoke` appelle — un type générique entre chevrons, des retours à la ligne,
 * rien ne l'arrête. Une forme qu'il ne sait pas lire (un nom dans une variable) est une FAUTE, pas un saut.
 */
function appelsDeFonctions(texte: string): { noms: string[]; illisibles: number } {
  const code = sansCommentaires(texte)
  const noms: string[] = []
  let illisibles = 0
  for (const m of code.matchAll(/functions\s*\.\s*invoke\b/g)) {
    let i = m.index + m[0].length
    const blanc = () => { while (/\s/.test(code[i] ?? '')) i++ }
    blanc()
    if (code[i] === '<') {
      let profondeur = 0
      for (; i < code.length; i++) {
        if (code[i] === '=' && code[i + 1] === '>') { i++; continue }
        if (code[i] === '<') profondeur++
        if (code[i] === '>' && --profondeur === 0) { i++; break }
      }
      blanc()
    }
    const appel = /^\(\s*(['"`])([a-z0-9-]+)\1/.exec(code.slice(i))
    if (appel) noms.push(appel[2])
    else illisibles++
  }
  for (const m of code.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) noms.push(m[1])
  return { noms, illisibles }
}

describe('le harnais part de TOUTES les fonctions', () => {
  const slugs = slugsDesFonctions()

  it('chaque dossier de supabase/functions a son contrat, et aucun contrat ne vise une fonction disparue', () => {
    expect(CONTRATS.map((c) => c.slug).sort()).toEqual(slugs)
    // Le plancher : seize fonctions, plus de trois cents scénarios. « Zéro faute » n'a de sens que s'il en reste à voir.
    expect(slugs.length).toBeGreaterThanOrEqual(16)
    expect(CONTRATS.reduce((n, c) => n + c.scenarios.length, 0)).toBeGreaterThanOrEqual(300)
  })

  it('les fonctions que la page appelle se lisent dans src/, et ce sont celles qui tiennent un préflight', () => {
    const sources = sourcesDeLaPage()
    const lus = sources.map((f) => ({ chemin: f.chemin, ...appelsDeFonctions(f.texte) }))
    expect(lus.filter((l) => l.illisibles > 0).map((l) => l.chemin), 'un appel dont le nom ne se lit pas').toEqual([])
    const appelees = new Set(lus.flatMap((l) => l.noms))
    // Le plancher du balayage : il voit la page appeler des fonctions, sinon « aucune » ne voudrait rien dire.
    expect(appelees.size).toBeGreaterThanOrEqual(14)
    for (const nom of appelees) expect(slugs, `la page appelle « ${nom} », qui n'existe pas`).toContain(nom)
    expect(CONTRATS.filter((c) => c.navigateur).map((c) => c.slug).sort()).toEqual([...appelees].sort())
    // Les autres sont nommées, avec leur raison : deux, au nombre près.
    expect(CONTRATS.filter((c) => !c.navigateur).map((c) => c.slug).sort()).toEqual(Object.keys(HORS_DU_NAVIGATEUR).sort())
    expect(Object.keys(HORS_DU_NAVIGATEUR)).toHaveLength(2)
  })

  it('le balayage voit un appel caché dans un générique multi-ligne, et refuse un nom qu’il ne sait pas lire — défauts plantés', () => {
    expect(appelsDeFonctions("await supabase.functions.invoke<{\n  a?: () => void\n}>('agent-comptable', { body })").noms).toEqual(['agent-comptable'])
    expect(appelsDeFonctions("supabase.functions.invoke<T>(\n  'plateforme-agreee',\n  { body })").noms).toEqual(['plateforme-agreee'])
    expect(appelsDeFonctions('supabase.functions.invoke(nomDeLaFonction, { body })').illisibles).toBe(1)
    expect(appelsDeFonctions("// supabase.functions.invoke('citee-en-commentaire')").noms).toEqual([])
  })

  it('le SDK du navigateur envoie au moins ses quatre en-têtes, et chacun passe par le préflight', () => {
    expect(contexte.entetesDuNavigateur).toEqual(expect.arrayContaining(['apikey', 'authorization', 'content-type', 'x-client-info']))
  })

  it.each(CONTRATS.map((c) => [c.slug, c] as const))('%s : un contrat qui couvre les quatre portes', (_slug, contrat: ContratFonction) => {
    const noms = contrat.scenarios.map((s) => s.nom)
    expect(new Set(noms).size, 'deux scénarios du même nom').toBe(noms.length)
    // Le préflight, pour une fonction de la page.
    if (contrat.navigateur) expect(noms).toContain('le préflight du navigateur passe, sans rien demander à personne')
    // Un refus sans les droits, sans aucune dépense.
    expect(contrat.scenarios.some((s) => s.attendu.aucuneDepense && [401, 403, 404, 405].includes(s.attendu.statut) && !s.defautConnu)).toBe(true)
    // Le chemin admis, qui dépense : le garde symétrique — sans lui, une fonction qui refuse tout passerait.
    expect(contrat.scenarios.some((s) => s.attendu.statut === 200)).toBe(true)
    // La batterie des corps mal formés, pour une fonction qui lit du JSON.
    const json = !['extract-piece', 'receive-email'].includes(contrat.slug)
    expect(noms.filter((n) => n.startsWith('corps mal formé')).length).toBe(json ? 7 : 0)
    expect(contrat.porte.length).toBeGreaterThan(20)
  })

  it('les défauts connus sont comptés, au nombre près — un de plus est une rechute, un de moins une raison morte', () => {
    const comptes: Record<string, number> = {}
    for (const c of CONTRATS) for (const s of c.scenarios) if (s.defautConnu) comptes[s.defautConnu] = (comptes[s.defautConnu] ?? 0) + 1
    expect(comptes).toEqual(Object.fromEntries(Object.entries(DEFAUTS_CONNUS).map(([cle, d]) => [cle, d.nombre])))
  })
})

describe.each(CONTRATS.map((c) => [c.slug, c] as const))('%s — contrats HTTP', (slug, contrat: ContratFonction) => {
  // Le compilateur se paie ici, une fois par fonction, pas dans le premier scénario.
  beforeAll(() => { for (const s of [slug, ...(contrat.voisines ?? [])]) prechauffer(sourceDe(s)) })
  it.each(contrat.scenarios.map((s) => [s.nom, s] as const))('%s', async (_nom, scenario) => {
    expect(await jugerScenario(contrat, scenario, contexte)).toEqual([])
  })
})

// ── DES DÉFAUTS PLANTÉS DANS LA VRAIE SOURCE, EN MÉMOIRE ─────────────────────────────────────────────────────────────
// Un juge qui rend « aucune faute » sur la vraie source n'a rien prouvé tant qu'on ne l'a pas vu en rendre une : chaque
// défaut ci-dessous est la forme exacte d'une régression que ce dépôt craint, posée dans la source servie (une copie en
// mémoire), et le scénario nommé doit la voir. Une ancre introuvable fait échouer le test : la mutation est à
// réécrire, pas à oublier.

interface DefautPlante {
  slug: string
  quoi: string
  remplacements: [string, string][]
  scenario: string
}

const DEFAUTS_PLANTES: DefautPlante[] = [
  {
    slug: 'extract-piece', quoi: 'le contrôle de l’appelant court-circuité',
    remplacements: [['    const autorise = await appelantAutorise(', '    const autorise = true || await appelantAutorise(']],
    scenario: 'un compte inscrit seul (l’inscription publique) : 401, corps non lu, rien de dépensé',
  },
  {
    slug: 'extract-piece', quoi: 'le corps lu avant le contrôle',
    remplacements: [
      ['    const fileBytes = new Uint8Array(await req.arrayBuffer())\n', ''],
      ['    const cleSecrete = cleSupabase("SUPABASE_SECRET_KEYS", Deno.env.get("SUPABASE_SECRET_KEYS"))\n',
        '    const fileBytes = new Uint8Array(await req.arrayBuffer())\n    const cleSecrete = cleSupabase("SUPABASE_SECRET_KEYS", Deno.env.get("SUPABASE_SECRET_KEYS"))\n'],
    ],
    scenario: 'sans en-tête ni clé : 401, corps non lu, le service d’authentification pas même interrogé',
  },
  {
    slug: 'extract-piece', quoi: 'le JSON illisible du modèle à nouveau cité au journal',
    remplacements: [[
      '    let citations: unknown = null\n    try {\n      citations = json ? JSON.parse(json) : null\n    } catch {\n      citations = null\n    }\n',
      '    const citations: unknown = json ? JSON.parse(json) : null\n',
    ]],
    scenario: 'le modèle rend un JSON illisible : rien du document ne part au journal',
  },
  {
    slug: 'create-cabinet', quoi: 'le refus rendu en 200',
    remplacements: [['return json({ error: "Réservé aux super-admins." }, 403)', 'return json({ error: "Réservé aux super-admins." }, 200)']],
    scenario: 'chef : refusé (403), et rien ne part',
  },
  {
    slug: 'agent-comptable', quoi: 'le plafond de blocage oublié',
    remplacements: [['  if (plafond.bloque) {', '  if (false) {']],
    scenario: 'le plafond de blocage atteint : 402, et pas un appel au modèle',
  },
  // LA GARDE PROVISOIRE DES VENTES FACTURÉES (VF9a) : jamais posée, posée sur tout dossier, ouverte sur un réglage
  // illisible, la date prise à Greenwich ou inventée, un outil qui l'oublie, un avertissement d'aujourd'hui écrasé. Depuis
  // VF9c, la garde ne vaut plus que pour un réglage illisible : ce qui la jugeait sur un dossier basculé se juge sur un
  // réglage absent de la ligne, et ce qui oublie la bascule, sur ce que chaque outil dit des ventes facturées. Et VF9c :
  // les trois clés, la panne de la fonction, le client d'une facture, le refus sur un dossier basculé, la balance.
  ...((): DefautPlante[] => {
    const slug = 'agent-comptable'
    const bascule = 'un dossier basculé : chaque outil dit ses ventes facturées — resume_dossier sa bascule, sa date (le jour de Paris) et ses comptes, lister_comptes les ventes pas écrites à jour, lister_pieces l’exemplaire par son numéro, lister_ecritures la source de chaque ligne, points_a_traiter trois clés de plus — et la consigne son paragraphe'
    const client = 'un dossier basculé : le client d’une facture n’atteint jamais le modèle — ni lu, ni par le libellé d’une écriture de vente facturée, ni par l’exemplaire d’une facture source'
    const panne = 'un dossier basculé, la fonction des ventes facturées en panne : sa clé dit « indisponible », sous son nom, les autres répondent, et la balance le dit'
    const inchange = 'un dossier qui n’a pas basculé : les réponses d’aujourd’hui, inchangées, et la consigne sans la ligne'
    const absente = 'la source des ventes absente de la ligne du dossier : la garde s’applique, côté fermé, et dit qu’elle n’a pas pu être lue'
    const enTexte = 'la source des ventes ni vraie ni fausse (« false » en texte) : la garde s’applique, côté fermé, et dit qu’elle n’a pas pu être lue'
    const sansDate = 'un dossier basculé dont la date ne se lit pas : ses ventes se lisent, et la phrase dit la date illisible'
    const garde = '  const ventes = gardeDesVentes(dossierRow.ventes_par_les_factures, dossierRow.ventes_par_les_factures_depuis)\n'
    const ouverte = '  if (reglage === false) return null\n'
    const jour = '  const jour = instant && !Number.isNaN(instant.getTime()) ? jourAParis(instant) : null\n'
    const refus = '    if (ventes?.reglage === null) {\n      return { erreur: `${ventes.constat}.'
    return [
      { slug, quoi: 'la garde jamais posée', remplacements: [[garde, garde.replace('= gardeDesVentes(', '= null && gardeDesVentes(')]], scenario: bascule },
      { slug, quoi: 'la garde posée sur tout dossier', remplacements: [[ouverte, '  if (reglage === "faux") return null\n']], scenario: inchange },
      { slug, quoi: 'un réglage absent lu comme faux', remplacements: [[ouverte, '  if (reglage !== true) return null\n']], scenario: absente },
      { slug, quoi: 'un réglage en texte lu comme le texte le dit', remplacements: [[ouverte, '  if (reglage === false || reglage === "false") return null\n']], scenario: enTexte },
      { slug, quoi: 'le jour de la bascule pris à Greenwich', remplacements: [[jour, jour.replace('jourAParis(instant)', '(depuis as string).slice(0, 10)')]], scenario: bascule },
      { slug, quoi: 'une date absente lue comme un instant', remplacements: [['  const instant = typeof depuis === "string" ? new Date(depuis) : null\n', '  const instant = new Date(depuis as string)\n']], scenario: sansDate },
      { slug, quoi: 'resume_dossier tait la bascule', remplacements: [['    if (!ventes) return resume\n', '    return resume\n']], scenario: bascule },
      { slug, quoi: 'points_a_traiter répond sur une source des ventes illisible', remplacements: [[refus, refus.replace('if (ventes?.reglage === null) {', 'if (false) {')]], scenario: absente },
      { slug, quoi: 'lister_comptes sans la garde', remplacements: [[' periode),\n      ventes,\n', ' periode),\n      null,\n']], scenario: absente },
      { slug, quoi: 'lister_pieces sans la garde', remplacements: [['      resultatListe(avecCategorie, count, "pieces"),\n      ventes,\n', '      resultatListe(avecCategorie, count, "pieces"),\n      null,\n']], scenario: absente },
      {
        slug, quoi: 'l’avertissement d’aujourd’hui écrasé par celui de la garde',
        remplacements: [['avertissement: typeof resultat.avertissement === "string" ? `${resultat.avertissement} ${phrase}` : phrase', 'avertissement: phrase']],
        scenario: absente,
      },
      { slug, quoi: 'la ligne de la consigne pour tout dossier', remplacements: [['      : ""\n  // L\'application est multi-cabinets', '      : "\\n- Ce dossier compte ses ventes par ses factures."\n  // L\'application est multi-cabinets']], scenario: inchange },
      { slug, quoi: 'la consigne sans sa ligne', remplacements: [['a figé.${repereVentes}\n', 'a figé.\n']], scenario: bascule },
      // VF9c.
      { slug, quoi: 'le refus de VF9a sur un dossier basculé', remplacements: [[refus, refus.replace('if (ventes?.reglage === null) {', 'if (ventes) {')]], scenario: bascule },
      { slug, quoi: 'points_a_traiter sans les trois clés des ventes facturées', remplacements: [['      ...(releve && enDefaut ? clesDesVentesFacturees(releve, enDefaut) : {}),\n', '']], scenario: bascule },
      {
        slug, quoi: 'la panne de la fonction des ventes facturées dite zéro',
        remplacements: [['"motif" in enDefaut ? `indisponible : ${enDefaut.motif}` : ventesFactureesEnDefaut(enDefaut.lues)', '"motif" in enDefaut ? 0 : ventesFactureesEnDefaut(enDefaut.lues)']],
        scenario: panne,
      },
      { slug, quoi: 'lister_comptes sans les ventes facturées en défaut', remplacements: [['      return phrase === null ? balance : joindreAvertissement(balance, phrase)\n', '      return balance\n']], scenario: bascule },
      // Réancré à VF9CQ1 : le libellé d'une vente facturée se recompose dans le seul passage (bloc PIÈCES DE VENTE).
      {
        slug, quoi: 'lister_ecritures rend le libellé d’une vente facturée tel que le brouillon le porte',
        remplacements: [['libelle: f ? `${f.type === "avoir" ? "Avoir" : "Facture"} ${numero(f)}` : null, source', 'libelle: libelleDuBrouillon(ligne), source']],
        scenario: client,
      },
      // Réancré à VF9C-Q1 : l'exemplaire d'une facture source, une pièce de vente, perd son tiers et son fichier au seul
      // passage vers le modèle (bloc PIÈCES DE VENTE), et non plus dans sa propre branche de `lister_pieces`.
      {
        slug, quoi: 'l’exemplaire d’une facture source rendu avec son tiers',
        remplacements: [['    const lues = ((data ?? []) as Record<string, unknown>[]).map(pieceVueParLeModele)\n', '    const lues = ((data ?? []) as Record<string, unknown>[])\n']],
        scenario: client,
      },
      // VF9C-Q1 : le client d'une pièce de vente — son tiers, son fichier, le libellé de ses écritures — au modèle, par l'un
      // ou l'autre outil, sur un dossier qui n'a pas basculé, basculé, ou dont la source des ventes ne se lit pas ; la règle
      // qui vise trop large (l'achat) ; le nom recomposé faux ; la consigne sans sa phrase ; le filtre par tiers oublié.
      ...((): DefautPlante[] => {
        const nonBascule = 'un dossier qui n’a pas basculé, en trésorerie : le client d’une pièce de vente n’atteint jamais le modèle — ni son tiers, ni son fichier, ni le libellé de ses écritures —, elle se nomme par sa date et son montant, sous chaque filtre et dans chaque clé qui la compte, et le fournisseur d’une pièce d’achat, lui, l’atteint (VF9C-Q1)'
        const basculeVente = 'un dossier basculé : le client d’une pièce de vente libre n’atteint pas le modèle, ni celui d’une facture, et sa ligne dit sa source (VF9C-Q1)'
        const illisibleVente = 'une source des ventes illisible : le client d’une pièce de vente n’atteint pas le modèle (VF9C-Q1)'
        const types = 'const TYPES_DONT_LE_TIERS_SE_DIT: readonly string[] = ["achat", "note_frais", "autre"]\n'
        // Réancrés à VF9CQ1 : une seule sélection pour tout dossier, la pièce et le mouvement de chaque ligne embarqués ; le
        // passage reçoit ce que le dossier sait de ses ventes, et l'outil n'a plus qu'un retour. Réancrés à VF9CQ1B : le
        // mouvement embarqué porte aussi son classement et ses lignes.
        const lignes = '    const lignes = ((data ?? []) as Record<string, unknown>[]).map((ligne) => ecritureVueParLeModele(ligne, nommees))\n'
        const mouvement = 'lignes_bancaires(date, montant, encaissements_de_factures, ecritures_brouillon(compte, facture_id, encaissement_id))'
        const embarquee = `, pieces(type_piece, date_piece, montant_ttc), ${mouvement}"`
        return [
          { slug, quoi: 'lister_pieces sans le passage vers le modèle', remplacements: [['    const lues = ((data ?? []) as Record<string, unknown>[]).map(pieceVueParLeModele)\n', '    const lues = ((data ?? []) as Record<string, unknown>[])\n']], scenario: nonBascule },
          { slug, quoi: 'lister_ecritures sans le passage vers le modèle', remplacements: [[lignes, lignes.replace('.map((ligne) => ecritureVueParLeModele(ligne, nommees))', '')]], scenario: nonBascule },
          {
            slug, quoi: 'lister_ecritures lue sans la pièce de chaque ligne, sur un dossier qui n’a pas basculé',
            remplacements: [[embarquee, `, ${mouvement}"`]], scenario: nonBascule,
          },
          {
            slug, quoi: 'lister_ecritures lue sans la pièce de chaque ligne, sur un dossier basculé',
            remplacements: [[embarquee, `, ${mouvement}"`]], scenario: basculeVente,
          },
          {
            slug, quoi: 'lister_ecritures, dossier basculé, ses lignes prises avant le passage',
            remplacements: [['    return resultatListe(lignes, count, "ecritures")\n', '    return resultatListe(nommees ? data : lignes, count, "ecritures")\n']], scenario: illisibleVente,
          },
          { slug, quoi: 'la vente prise pour un type qui dit son tiers', remplacements: [[types, types.replace('"autre"]', '"autre", "vente"]')]], scenario: nonBascule },
          { slug, quoi: 'l’achat pris pour une vente : la règle vise trop large', remplacements: [[types, types.replace('["achat", ', '[')]], scenario: nonBascule },
          {
            slug, quoi: 'la ligne d’une pièce de vente sous le libellé du brouillon',
            remplacements: [['  return lue.type_piece === "vente" ? nomDUnePieceDeVente(', '  return lue.type_piece === "vente" ? libelleDuBrouillon(ligne) ?? nomDUnePieceDeVente(']], scenario: nonBascule,
          },
          {
            slug, quoi: 'la date d’une pièce de vente telle que la base l’écrit',
            remplacements: [['    ? `du ${piece.date_piece.slice(8, 10)}/${piece.date_piece.slice(5, 7)}/${piece.date_piece.slice(0, 4)}`\n', '    ? `du ${piece.date_piece}`\n']], scenario: nonBascule,
          },
          { slug, quoi: 'la consigne sans la phrase des pièces de vente', remplacements: [['\n- Une PIÈCE DE VENTE (type_piece « vente ») se nomme par sa date et son montant', '\n- Une pièce de vente se nomme comme on veut']], scenario: nonBascule },
          { slug, quoi: 'le filtre par tiers oublié', remplacements: [['    if (typeof input.tiers === "string" && input.tiers) q = q.ilike("tiers", `%${input.tiers}%`)\n', '']], scenario: nonBascule },
        ]
      })(),
      // VF9CQ1 : qui a payé un crédit, ou le libellé d'une ligne rattachée à rien, au modèle — par la règle du crédit, du sens,
      // de la ligne rattachée à rien, du côté fermé, par l'outil qui lit sans le mouvement, la consigne ou la description ; la
      // règle qui vise trop large (le débit, les écritures composées) ; la source d'un crédit classé perdue.
      ...((): DefautPlante[] => {
        const tresorerie = 'un dossier qui n’a pas basculé, en trésorerie : ni qui a payé un crédit du relevé ni le libellé d’une ligne rattachée à rien n’atteignent le modèle — chaque ligne d’un crédit, de toute sorte, se nomme par la date et le montant du mouvement —, le libellé d’un débit et d’une écriture composée l’atteignent, et un sens illisible tombe du côté fermé (VF9CQ1)'
        const engagement = tresorerie.replace('en trésorerie', 'en engagement')
        const basculeReleve = 'un dossier basculé : ni qui a payé un crédit — classé par ses encaissements, d’un virement mixte, ou de toute autre sorte — ni le libellé d’une ligne rattachée à rien n’atteignent le modèle, et chaque ligne garde sa source (VF9CQ1)'
        const illisibleReleve = 'une source des ventes illisible : ni qui a payé un crédit ni le libellé d’une ligne rattachée à rien n’atteignent le modèle (VF9CQ1)'
        // Réancrés à VF9CQ1B : le débit a sa branche, et le crédit prend le mouvement nommé.
        const debit = '  if (lu.montant < 0) {\n    return debitQuiRendLArgentDUnClient(mouvement as Record<string, unknown>) ? nomDUnDebitDuReleve(nomme) : libelleDuBrouillon(ligne)\n  }\n'
        return [
          { slug, quoi: 'le libellé d’un crédit rendu tel que le brouillon le porte', remplacements: [['  return nomDUnCreditDuReleve(nomme)\n', '  return libelleDuBrouillon(ligne) ?? nomDUnCreditDuReleve(nomme)\n']], scenario: tresorerie },
          { slug, quoi: 'le crédit jugé sur le sens de la ligne, pas sur le mouvement', remplacements: [['  if (lu.montant < 0) {\n', '  if (ligne.sens === "credit") {\n']], scenario: engagement },
          { slug, quoi: 'le débit recomposé lui aussi : la règle vise trop large', remplacements: [[debit, '']], scenario: tresorerie },
          { slug, quoi: 'une ligne rattachée à rien qui garde son libellé', remplacements: [['  return { libelle: null, source: null }\n}\n\n// Ce que le modèle reçoit', '  return { libelle: libelleDuBrouillon(ligne), source: null }\n}\n\n// Ce que le modèle reçoit']], scenario: tresorerie },
          {
            slug, quoi: 'un mouvement que la lecture n’a pas rendu pris pour un débit',
            remplacements: [['  if (mouvement === null || typeof mouvement !== "object") return null\n', '  if (mouvement === null || typeof mouvement !== "object") return libelleDuBrouillon(ligne)\n']], scenario: tresorerie,
          },
          {
            slug, quoi: 'un mouvement de zéro euro pris pour un débit',
            remplacements: [[' || lu.montant === 0) return null', ') return null'], ['  if (lu.montant < 0) {\n', '  if (lu.montant <= 0) {\n']], scenario: tresorerie,
          },
          { slug, quoi: 'les écritures composées sans pièce ni mouvement tues : la règle vise trop large', remplacements: [['    return { libelle: libelleDuBrouillon(ligne), source: null }\n  }\n', '    return { libelle: null, source: null }\n  }\n']], scenario: tresorerie },
          { slug, quoi: 'lister_ecritures lue sans le mouvement de chaque ligne', remplacements: [[`, ${'lignes_bancaires(date, montant, encaissements_de_factures, ecritures_brouillon(compte, facture_id, encaissement_id))'}"`, '"']], scenario: tresorerie },
          {
            slug, quoi: 'la ligne d’un crédit classé par ses encaissements sous le libellé du brouillon',
            remplacements: [['    return { libelle: libelleDUneLigneDuReleve(ligne), source:', '    return { libelle: classe ? libelleDuBrouillon(ligne) : libelleDUneLigneDuReleve(ligne), source:']], scenario: basculeReleve,
          },
          { slug, quoi: 'la source d’un crédit classé par ses encaissements perdue', remplacements: [['source: classe ? "mouvement_d_encaissements" : null', 'source: null']], scenario: basculeReleve },
          {
            slug, quoi: 'lister_ecritures passe ses lignes sans ce que le dossier sait de ses ventes',
            remplacements: [['.map((ligne) => ecritureVueParLeModele(ligne, nommees))', '.map((ligne) => ecritureVueParLeModele(ligne, null))']], scenario: illisibleReleve,
          },
          { slug, quoi: 'la consigne sans la phrase du crédit du relevé', remplacements: [['\n- Un CRÉDIT du relevé (un mouvement qui entre en banque) se nomme', '\n- Un crédit du relevé se nomme']], scenario: tresorerie },
          { slug, quoi: 'la description de lister_ecritures sans le nom d’un crédit', remplacements: [[' (« Crédit du relevé du JJ/MM/AAAA, 0,00 € ») : qui a payé', ' : qui a payé']], scenario: tresorerie },
        ]
      })(),
      // VF9CQ1B : à qui un débit rend ou défait l'argent d'un client, au modèle — par la règle du débit, ses deux
      // reconnaissances, le côté fermé, l'outil qui lit sans le classement ou sans les lignes du mouvement, la consigne ou la
      // description ; la règle qui vise trop large (tout débit nommé, le fournisseur pris pour un client).
      ...((): DefautPlante[] => {
        const tresorerie = 'un dossier qui n’a pas basculé, en trésorerie : ni qui a payé un crédit du relevé ni le libellé d’une ligne rattachée à rien n’atteignent le modèle — chaque ligne d’un crédit, de toute sorte, se nomme par la date et le montant du mouvement —, le libellé d’un débit et d’une écriture composée l’atteignent, et un sens illisible tombe du côté fermé (VF9CQ1)'
        const engagement = tresorerie.replace('en trésorerie', 'en engagement')
        const basculeReleve = 'un dossier basculé : ni qui a payé un crédit — classé par ses encaissements, d’un virement mixte, ou de toute autre sorte — ni le libellé d’une ligne rattachée à rien n’atteignent le modèle, et chaque ligne garde sa source (VF9CQ1)'
        const reconnu = '? nomDUnDebitDuReleve(nomme) : libelleDuBrouillon(ligne)\n'
        const racines = 'const RACINES_DES_COMPTES_D_UN_CLIENT: readonly string[] = ["7", "41"]\n'
        const classement = '  if (mouvement.encaissements_de_factures !== false) return true\n'
        return [
          { slug, quoi: 'tout débit sous son libellé, comme hier', remplacements: [[reconnu, '? libelleDuBrouillon(ligne) : libelleDuBrouillon(ligne)\n']], scenario: tresorerie },
          { slug, quoi: 'tout débit sous son libellé, d’un dossier basculé', remplacements: [[reconnu, '? libelleDuBrouillon(ligne) : libelleDuBrouillon(ligne)\n']], scenario: basculeReleve },
          { slug, quoi: 'tout débit nommé : la règle vise trop large', remplacements: [[reconnu, '? nomDUnDebitDuReleve(nomme) : nomDUnDebitDuReleve(nomme)\n']], scenario: tresorerie },
          { slug, quoi: 'le produit oublié des comptes d’un client', remplacements: [[racines, racines.replace('["7", "41"]', '["41"]')]], scenario: tresorerie },
          { slug, quoi: 'le client oublié des comptes d’un client', remplacements: [[racines, racines.replace('["7", "41"]', '["7"]')]], scenario: engagement },
          { slug, quoi: 'le fournisseur pris pour un client : la règle vise trop large', remplacements: [[racines, racines.replace('["7", "41"]', '["7", "4"]')]], scenario: engagement },
          { slug, quoi: 'le classement par les contre-passations oublié', remplacements: [[classement, '']], scenario: basculeReleve },
          { slug, quoi: 'un classement illisible pris pour un débit ordinaire', remplacements: [[classement, classement.replace('!== false', '=== true')]], scenario: tresorerie },
          { slug, quoi: 'lister_ecritures lue sans le classement du mouvement', remplacements: [['lignes_bancaires(date, montant, encaissements_de_factures, ', 'lignes_bancaires(date, montant, ']], scenario: tresorerie },
          { slug, quoi: 'lister_ecritures lue sans les lignes du mouvement', remplacements: [['encaissements_de_factures, ecritures_brouillon(compte, facture_id, encaissement_id))"', 'encaissements_de_factures)"']], scenario: tresorerie },
          { slug, quoi: 'la consigne sans le débit qui rend l’argent d’un client', remplacements: [['De même, un DÉBIT qui rend ou défait l\'argent d\'un client', 'De même, un débit']], scenario: tresorerie },
          { slug, quoi: 'la description de lister_ecritures sans le nom d’un débit', remplacements: [[' (« Débit du relevé du JJ/MM/AAAA, 0,00 € ») : à qui', ' : à qui']], scenario: tresorerie },
        ]
      })(),
      // La caisse (ligne 26.6, étape C5) : qui a versé les espèces d'une recette, au modèle — la ligne d'une opération sous le
      // libellé du brouillon, tue, l'opération non lue ; la source perdue ; la consigne, la description de lister_ecritures et
      // la clé de points_a_traiter qui ne disent plus la caisse. La clé oubliée des rattachements ne change rien qu'un appel
      // HTTP voie — la sélection lit toujours la colonne — : agentComptablePiecesDeVente.test.ts la garde, contre le schéma
      // exporté et sur une ligne lue sans elle.
      ...((): DefautPlante[] => {
        const tresorerie = 'un dossier qui n’a pas basculé, en trésorerie : ni qui a payé un crédit du relevé ni le libellé d’une ligne rattachée à rien n’atteignent le modèle — chaque ligne d’un crédit, de toute sorte, se nomme par la date et le montant du mouvement —, le libellé d’un débit et d’une écriture composée l’atteignent, et un sens illisible tombe du côté fermé (VF9CQ1)'
        const basculeReleve = 'un dossier basculé : ni qui a payé un crédit — classé par ses encaissements, d’un virement mixte, ou de toute autre sorte — ni le libellé d’une ligne rattachée à rien n’atteignent le modèle, et chaque ligne garde sa source (VF9CQ1)'
        const caisse = '  if (ligne.operation_caisse_id != null) return { libelle: libelleDUneLigneDeCaisse(ligne), source: "caisse" }\n'
        return [
          { slug, quoi: 'la ligne d’une opération de caisse sous le libellé du brouillon', remplacements: [[caisse, caisse.replace('libelleDUneLigneDeCaisse(ligne)', 'libelleDuBrouillon(ligne)')]], scenario: tresorerie },
          { slug, quoi: 'la ligne d’une opération de caisse sous le libellé du brouillon, d’un dossier basculé', remplacements: [[caisse, caisse.replace('libelleDUneLigneDeCaisse(ligne)', 'libelleDuBrouillon(ligne)')]], scenario: basculeReleve },
          { slug, quoi: 'la caisse tue, comme une ligne rattachée à rien', remplacements: [[caisse, '']], scenario: tresorerie },
          { slug, quoi: 'la source d’une ligne de caisse perdue', remplacements: [[caisse, caisse.replace('source: "caisse"', 'source: null')]], scenario: basculeReleve },
          { slug, quoi: 'lister_ecritures lue sans l’opération de caisse de chaque ligne', remplacements: [[' operations_caisse(genre, date, montant),', '']], scenario: tresorerie },
          { slug, quoi: 'une opération que la lecture n’a pas rendue sous le libellé du brouillon', remplacements: [['  if (operation === null || typeof operation !== "object") return null\n', '  if (operation === null || typeof operation !== "object") return libelleDuBrouillon(ligne)\n']], scenario: tresorerie },
          { slug, quoi: 'des espèces rendues sous le mot d’une recette', remplacements: [['  const nom = operation.genre === "recette" && montant < 0 ? "Espèces rendues" : mots\n', '  const nom = mots\n']], scenario: tresorerie },
          { slug, quoi: 'la consigne sans la phrase de la caisse', remplacements: [['La caisse ne nomme personne — le détail, recette par recette, reste à ce brouillard — : ne le demande pas', 'La caisse dit ce qu’elle peut']], scenario: tresorerie },
          { slug, quoi: 'la description de lister_ecritures sans le nom d’une opération de caisse', remplacements: [[' Celui d\'une ligne d\'une opération de caisse se recompose', ' Une ligne de caisse se recompose']], scenario: tresorerie },
          { slug, quoi: 'points_a_traiter sans la caisse', remplacements: [['      caisse: CAISSE_NON_VERIFIEE,\n', '']], scenario: tresorerie },
        ]
      })(),
    ]
  })(),
  {
    slug: 'evaluer-extraction', quoi: 'la fenêtre datée oubliée',
    remplacements: [['    if (limite > 0 && Date.now() > Date.parse(ESSAI_OUVERT_JUSQU_A)) {', '    if (false) {']],
    scenario: 'fenêtre fermée : 403 sur « extraction », sans client ni lecture',
  },
  {
    slug: 'receive-email', quoi: 'une signature fausse acceptée',
    remplacements: [['    return new Response("Signature invalide", { status: 401 })', '    event = JSON.parse(rawBody)']],
    scenario: 'signé d’un autre secret : 401, rien de lu',
  },
  // LA TRACE D'UNE PIÈCE JOINTE ÉCARTÉE (ligne 22.7) : jetée, mal écrite, instable au rejeu, tirée du poids au lieu des
  // identifiants, ou gardant l'identifiant de Resend tel quel ; et son refus par la base, tu.
  {
    slug: 'receive-email', quoi: 'la trace d’un format refusé jetée',
    remplacements: [['        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "format", bytes.byteLength)\n', '']],
    scenario: 'une pièce jointe d’un format que le seau n’admet pas : écartée avant tout dépôt, journalisée sans son nom, consignée pour le cabinet',
  },
  {
    slug: 'receive-email', quoi: 'la trace d’un poids refusé jetée',
    remplacements: [['        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "taille", bytes.byteLength)\n', '']],
    scenario: 'une pièce jointe plus lourde que la borne d’une pièce : écartée avant tout dépôt, consignée pour le cabinet',
  },
  {
    slug: 'receive-email', quoi: 'la raison mal écrite',
    remplacements: [['fichier.id, "format", bytes.byteLength)', 'fichier.id, "formats", bytes.byteLength)']],
    scenario: 'une pièce jointe d’un format que le seau n’admet pas : écartée avant tout dépôt, journalisée sans son nom, consignée pour le cabinet',
  },
  {
    slug: 'receive-email', quoi: 'la clé d’idempotence instable (un tirage dans l’empreinte)',
    remplacements: [['JSON.stringify([emailId, pieceJointeId])', 'JSON.stringify([emailId, pieceJointeId, crypto.randomUUID()])']],
    scenario: 'Resend rejoue le webhook : la pièce jointe écartée ne se consigne pas une seconde fois, et sans erreur',
  },
  {
    slug: 'receive-email', quoi: 'la clé d’idempotence ignorée (une insertion simple, que le rejeu fait refuser)',
    remplacements: [[
      '.upsert({ dossier_id: dossierId, raison, octets, empreinte }, { onConflict: "dossier_id,empreinte", ignoreDuplicates: true })',
      '.insert({ dossier_id: dossierId, raison, octets, empreinte })',
    ]],
    scenario: 'Resend rejoue le webhook : la pièce jointe écartée ne se consigne pas une seconde fois, et sans erreur',
  },
  {
    slug: 'receive-email', quoi: 'l’empreinte tirée du poids, comme d’un contenu, et non des identifiants',
    remplacements: [['JSON.stringify([emailId, pieceJointeId])', 'String(octets)']],
    scenario: 'deux pièces jointes hors format au même contenu : chacune sa trace, sans nom ni contenu au journal ni dans la trace',
  },
  {
    slug: 'receive-email', quoi: 'l’identifiant de Resend gardé tel quel',
    remplacements: [['upsert({ dossier_id: dossierId, raison, octets, empreinte }', 'upsert({ dossier_id: dossierId, raison, octets, empreinte: pieceJointeId }']],
    scenario: 'une pièce jointe d’un format que le seau n’admet pas : écartée avant tout dépôt, journalisée sans son nom, consignée pour le cabinet',
  },
  {
    slug: 'receive-email', quoi: 'le refus de la trace tu',
    remplacements: [[
      '    console.error(`[receive-email] pièce jointe écartée NON consignée (${raison}, ${octets === null ? "poids inconnu" : `${octets} octets`}) : ${erreur}`)\n',
      '',
    ]],
    scenario: 'la base refuse la trace : le refus est journalisé sans nom, et la pièce jointe suivante se dépose',
  },
  {
    slug: 'create-client-access', quoi: 'le contrôle d’accès demandé avec la clé de service (personne n’y passe plus)',
    remplacements: [['await supabaseAsCaller.rpc("admin_du_dossier"', 'await supabaseAdmin.rpc("admin_du_dossier"']],
    scenario: 'chef : l’accès client est créé sur le dossier',
  },
  // Le défaut d'avant le 10/10/2026 : le mot de passe saisi posé sur le compte repris, avant l'écriture de l'accès
  // (décision du cabinet : un compte existant garde son mot de passe). Puis une réponse qui en dirait plus, d'un compte
  // que le cabinet ne connaît pas, que ce que la fonction en disait.
  {
    slug: 'create-client-access', quoi: 'le mot de passe du compte repris à nouveau posé',
    remplacements: [['    compte = "existant"\n', '    await supabaseAdmin.auth.admin.updateUserById(clientUserId, { password })\n    compte = "existant"\n']],
    scenario: 'un compte existant déjà lié au cabinet (un membre de son équipe) : repris tel qu’il est, et la réponse le dit',
  },
  {
    slug: 'create-team-member', quoi: 'le mot de passe posé, puis l’ajout refusé',
    remplacements: [['    compte = "existant"\n', '    await admin.auth.admin.updateUserById(userId, { password })\n    compte = "existant"\n']],
    scenario: 'un membre déjà dans l’équipe : 409, rien n’a changé, son mot de passe non plus',
  },
  {
    slug: 'create-client-access', quoi: 'le refus d’un compte d’ailleurs qui rend son identifiant',
    remplacements: [[
      '          rattachementAConfirmer: true,\n        }, 409)',
      '          rattachementAConfirmer: true,\n          compteId: clientUserId,\n        }, 409)',
    ]],
    scenario: 'le chef d’un autre cabinet, que ce cabinet ne connaît pas, sans confirmation : 409, le même refus et son marqueur, rien d’écrit, le compte intact',
  },
  // LE RATTACHEMENT CONFIRMÉ (23-Q2) : la confirmation acceptée sous une autre forme, lue après le contrôle du dossier ou
  // passée outre lui ; l'accès écrit avant elle, ou elle ignorée ; le mot de passe posé ; le marqueur oublié, ou posé sur
  // un compte connu ou sur un refus définitif ; un compte qui ne peut pas être client rattaché ; sa vérification en panne
  // prise pour un « non ».
  {
    slug: 'create-client-access', quoi: 'la confirmation acceptée sous une autre forme (un texte non vide confirme)',
    remplacements: [
      ['  if (!booleenOuAbsent(confirmationLue)) {', '  if (false) {'],
      ['  const rattachementConfirme = confirmationLue === true', '  const rattachementConfirme = !!confirmationLue'],
    ],
    scenario: 'la confirmation reçue en texte (« oui ») : 400 en français, avant le contrôle du dossier, aucun compte cherché',
  },
  {
    slug: 'create-client-access', quoi: 'le type de la confirmation plus contrôlé (un nombre passe pour une absence)',
    remplacements: [['  if (!booleenOuAbsent(confirmationLue)) {', '  if (false) {']],
    scenario: 'la confirmation reçue en nombre (1) : 400 en français, avant le contrôle du dossier, aucun compte cherché',
  },
  {
    slug: 'create-client-access', quoi: 'la confirmation lue dans un texte (« true » confirme)',
    remplacements: [
      ['  return valeur == null || typeof valeur === "boolean"', '  return valeur == null || typeof valeur === "boolean" || typeof valeur === "string"'],
      ['  const rattachementConfirme = confirmationLue === true', '  const rattachementConfirme = confirmationLue === true || confirmationLue === "true"'],
    ],
    scenario: 'la confirmation reçue en texte (« true ») : 400 en français, avant le contrôle du dossier, aucun compte cherché',
  },
  {
    slug: 'create-client-access', quoi: 'la confirmation lue après le contrôle du dossier',
    remplacements: [
      [
        '  if (!booleenOuAbsent(confirmationLue)) {\n    return json({ error: "rattachementConfirme doit être un booléen (true pour confirmer le rattachement)." }, 400)\n  }\n',
        '',
      ],
      [
        '  if (!aAcces) {\n    return json({ error: "Dossier introuvable." }, 404)\n  }\n',
        '  if (!aAcces) {\n    return json({ error: "Dossier introuvable." }, 404)\n  }\n'
        + '  if (!booleenOuAbsent(confirmationLue)) {\n    return json({ error: "rattachementConfirme doit être un booléen (true pour confirmer le rattachement)." }, 400)\n  }\n',
      ],
    ],
    scenario: 'la confirmation reçue en nombre (1) : 400 en français, avant le contrôle du dossier, aucun compte cherché',
  },
  {
    slug: 'create-client-access', quoi: 'la confirmation qui passe outre le contrôle du dossier',
    remplacements: [['  if (!aAcces) {', '  if (!aAcces && !rattachementConfirme) {']],
    scenario: 'comptableNonAssigne, rattachement confirmé : refusé (404), la confirmation n’ouvre pas le dossier, rien ne part',
  },
  {
    slug: 'create-client-access', quoi: 'l’accès écrit avant la confirmation',
    remplacements: [[
      '      if (!rattachementConfirme) {\n',
      '      await supabaseAdmin.from("memberships").insert({ user_id: clientUserId, dossier_id: dossierId, role: "client", email })\n      if (!rattachementConfirme) {\n',
    ]],
    scenario: 'un compte inscrit seul, que ce cabinet ne connaît pas, sans confirmation : 409, le même refus et son marqueur, rien d’écrit, le compte intact',
  },
  {
    slug: 'create-client-access', quoi: 'la confirmation ignorée (le compte reste refusé)',
    remplacements: [['      if (!rattachementConfirme) {\n', '      if (true) {\n']],
    scenario: 'un compte inscrit seul, rattachement confirmé : l’accès s’écrit, sans aucun droit, la réponse dit « existant », le compte intact',
  },
  {
    slug: 'create-client-access', quoi: 'le mot de passe posé sur le compte rattaché sur confirmation',
    remplacements: [['      if (particulier) {\n', '      await supabaseAdmin.auth.admin.updateUserById(clientUserId, { password })\n      if (particulier) {\n']],
    scenario: 'un compte inscrit seul, rattachement confirmé : l’accès s’écrit, sans aucun droit, la réponse dit « existant », le compte intact',
  },
  {
    slug: 'create-client-access', quoi: 'le marqueur oublié sur le premier refus',
    remplacements: [['          rattachementAConfirmer: true,\n        }, 409)', '        }, 409)']],
    scenario: 'un compte inscrit seul, que ce cabinet ne connaît pas, sans confirmation : 409, le même refus et son marqueur, rien d’écrit, le compte intact',
  },
  {
    slug: 'create-client-access', quoi: 'le marqueur sur le refus d’un compte connu (un accès déjà donné)',
    remplacements: [[
      'envoie-lui un lien de réinitialisation depuis la liste des accès.",\n      }, 409)',
      'envoie-lui un lien de réinitialisation depuis la liste des accès.",\n        rattachementAConfirmer: true,\n      }, 409)',
    ]],
    scenario: 'un accès déjà donné sur ce dossier : 409, rien n’a changé, le mot de passe du client non plus',
  },
  {
    slug: 'create-client-access', quoi: 'le marqueur sur la réponse d’un compte connu repris',
    remplacements: [['  return json({ ok: true, compte })', '  return json({ ok: true, compte, rattachementAConfirmer: compte === "existant" })']],
    scenario: 'un compte existant déjà lié au cabinet (un membre de son équipe) : repris tel qu’il est, et la réponse le dit',
  },
  {
    slug: 'create-client-access', quoi: 'le marqueur sur le refus d’un compte qui ne peut pas être client (l’écran bouclerait)',
    remplacements: [[
      'Demande à cette personne d\'utiliser une autre adresse e-mail.",\n        }, 409)',
      'Demande à cette personne d\'utiliser une autre adresse e-mail.",\n          rattachementAConfirmer: true,\n        }, 409)',
    ]],
    scenario: 'le chef d’un autre cabinet, rattachement confirmé : 409, il ne reçoit pas d’accès client, sans marqueur, rien d’écrit, le compte intact',
  },
  {
    slug: 'create-client-access', quoi: 'le membre d’un autre cabinet rattaché sur confirmation',
    remplacements: [['  if (membre) return true\n', '']],
    scenario: 'le chef d’un autre cabinet, rattachement confirmé : 409, il ne reçoit pas d’accès client, sans marqueur, rien d’écrit, le compte intact',
  },
  {
    slug: 'create-client-access', quoi: 'le super-administrateur rattaché sur confirmation',
    remplacements: [['  return !!superAdmin', '  return false']],
    scenario: 'le super-administrateur, rattachement confirmé : 409, il ne reçoit pas d’accès client, sans marqueur, rien d’écrit, le compte intact',
  },
  {
    slug: 'create-client-access', quoi: 'la lecture des membres en panne prise pour un « non »',
    remplacements: [['  if (erreurMembre) return null\n', '']],
    scenario: 'la vérification du compte en panne (cabinet_admins), rattachement confirmé : 500 qui le dit, rien d’écrit, le compte intact',
  },
  {
    slug: 'create-client-access', quoi: 'la lecture des super-administrateurs en panne prise pour un « non »',
    remplacements: [['  if (erreurSuperAdmin) return null\n', '']],
    scenario: 'la vérification du compte en panne (super_admins), rattachement confirmé : 500 qui le dit, rien d’écrit, le compte intact',
  },
  {
    slug: 'create-client-access', quoi: 'la vérification en panne qui rattache quand même',
    remplacements: [['      if (particulier === null) {', '      if (particulier === undefined) {']],
    scenario: 'la vérification du compte en panne (super_admins), rattachement confirmé : 500 qui le dit, rien d’écrit, le compte intact',
  },
  // LE LIEN D'UN COMPTE AVEC CE CABINET, LU AVEC SON ERREUR (le « À REVOIR » de 23-Q2), dans les deux fonctions : chacune
  // des trois lectures d'`appartientDejaAuCabinet` en panne de nouveau prise pour un « non », et la panne qui laisse
  // passer le refus d'un compte inconnu (sa confirmation, dans l'onglet Accès) au lieu du 500.
  ...([
    ['create-client-access', 'sans confirmation', 'le client d’un autre de ses dossiers', 'un membre de son équipe'],
    ['create-team-member', '', 'le client du dossier', 'un membre de son équipe'],
  ] as const).flatMap(([slug, forme, client, membre]): DefautPlante[] => {
    const scenario = (table: string, quoi: string) => slug === 'create-client-access'
      ? `le lien du compte avec ce cabinet illisible (${table}), pour ${quoi}, ${forme} : 500 qui le dit, sans marqueur, rien d’écrit, le compte intact`
      : `le lien du compte avec ce cabinet illisible (${table}), pour ${quoi} : 500 qui le dit, personne n’est ajouté, aucun compte touché`
    return [
      {
        slug, quoi: 'la lecture des dossiers du cabinet en panne prise pour un « non »',
        remplacements: [['  if (erreurDossiers) return null\n', '']],
        scenario: scenario('dossiers', client),
      },
      {
        slug, quoi: 'la lecture des accès du compte en panne prise pour un « non »',
        remplacements: [['    if (erreurAcces) return null\n', '']],
        scenario: scenario('memberships', client),
      },
      {
        slug, quoi: 'la lecture de l’équipe en panne prise pour un « non »',
        remplacements: [['  if (erreurEquipe) return null\n', '']],
        scenario: scenario('cabinet_admins', membre),
      },
      {
        slug, quoi: 'le lien illisible qui retombe sur le refus d’un compte inconnu',
        remplacements: [['    if (connu === null) {', '    if (connu === undefined) {']],
        scenario: scenario('memberships', client),
      },
    ]
  }),
  // UN COMPTE CLIENT D'UN AUTRE CABINET N'ENTRE PAS DANS L'ÉQUIPE (23Q2-Q2) : le contrôle oublié, l'équipe écrite avant
  // lui, sa panne prise pour un « non », le cabinet de l'appelant comparé au lieu du cabinet visé, tout accès client pris
  // pour un accès ailleurs, et la phrase qui dirait la relation du compte avec un autre cabinet.
  {
    slug: 'create-team-member', quoi: 'le client d’un autre cabinet admis (le contrôle oublié)',
    remplacements: [['    if (clientAilleurs) {\n', '    if (false) {\n']],
    scenario: 'le client d’un autre de ses dossiers, client aussi d’un autre cabinet (rattaché sur confirmation, 23-Q2) : 409, une phrase qui ne dit ni quel cabinet ni qu’il y est client, rien d’écrit, le compte intact',
  },
  {
    slug: 'create-team-member', quoi: 'l’équipe écrite avant le contrôle',
    remplacements: [[
      '    const clientAilleurs = await accesClientDansUnAutreCabinet(admin, userId, cabinetId)\n',
      '    await admin.from("cabinet_admins").insert({ user_id: userId, cabinet_id: cabinetId, role, email })\n'
      + '    const clientAilleurs = await accesClientDansUnAutreCabinet(admin, userId, cabinetId)\n',
    ]],
    scenario: 'le client du dossier, client aussi d’un autre cabinet : 409, une phrase qui ne dit ni quel cabinet ni qu’il y est client, rien d’écrit, le compte intact',
  },
  {
    slug: 'create-team-member', quoi: 'la vérification d’un accès ailleurs en panne prise pour un « non »',
    remplacements: [['  if (erreurAilleurs || !acces) return null\n', '  if (!acces) return false\n']],
    scenario: 'la vérification d’un accès dans un autre cabinet en panne : 500 qui le dit, personne n’est ajouté, aucun compte touché',
  },
  {
    slug: 'create-team-member', quoi: 'le cabinet de l’appelant comparé au lieu du cabinet visé',
    remplacements: [[
      'await accesClientDansUnAutreCabinet(admin, userId, cabinetId)',
      'await accesClientDansUnAutreCabinet(admin, userId, adminRow?.cabinet_id ?? cabinetId)',
    ]],
    scenario: 'super-admin, chef du premier cabinet, pour l’autre : un compte client de cet autre cabinet seulement y entre sur confirmation, tel qu’il est',
  },
  {
    slug: 'create-team-member', quoi: 'tout accès client pris pour un accès ailleurs (le dossier comparé au cabinet)',
    remplacements: [['    .neq("dossiers.cabinet_id", cabinetId)\n', '    .neq("dossier_id", cabinetId)\n']],
    scenario: 'le client de deux dossiers de ce cabinet : repris sur confirmation, tel qu’il est — seul un accès dans un AUTRE cabinet le retient',
  },
  // LE CLIENT D'UN DOSSIER DE CE CABINET N'ENTRE DANS L'ÉQUIPE QU'APRÈS UNE CONFIRMATION (23Q2Q2-Q1) : la confirmation
  // oubliée, l'équipe écrite avant elle, la confirmation admise sous une autre forme, la ligne d'équipe en panne prise pour
  // un « non », et le marqueur posé sur le membre d'une équipe.
  {
    slug: 'create-team-member', quoi: 'le client de ce cabinet admis sans confirmation',
    remplacements: [['    if (!membre && !entreeConfirmee) {\n', '    if (false) {\n']],
    scenario: 'le client du dossier, sans confirmation : 409, la phrase et son marqueur, personne n’entre, le compte intact',
  },
  {
    slug: 'create-team-member', quoi: 'l’équipe écrite avant la confirmation',
    remplacements: [[
      '    const membre = await ligneDEquipe(admin, userId)\n',
      '    await admin.from("cabinet_admins").insert({ user_id: userId, cabinet_id: cabinetId, role, email })\n'
      + '    const membre = await ligneDEquipe(admin, userId)\n',
    ]],
    scenario: 'le client d’un autre de ses dossiers, rattaché sur confirmation (23-Q2), sans confirmation : 409, la phrase et son marqueur, personne n’entre, le compte intact',
  },
  {
    slug: 'create-team-member', quoi: 'la confirmation admise en texte',
    remplacements: [
      ['  if (!booleenOuAbsent(confirmationLue)) {\n', '  if (false) {\n'],
      ['  const entreeConfirmee = confirmationLue === true\n', '  const entreeConfirmee = !!confirmationLue\n'],
    ],
    scenario: 'la confirmation de l’entrée reçue en texte (« oui ») : 400 en français, aucun compte cherché, personne n’entre',
  },
  {
    slug: 'create-team-member', quoi: 'la ligne d’équipe en panne prise pour un « non »',
    remplacements: [['  if (erreurLigne) return null\n', '']],
    scenario: 'la ligne d’équipe illisible, pour le client du dossier, sans confirmation : 500 qui le dit, sans marqueur, personne n’entre',
  },
  {
    slug: 'create-team-member', quoi: 'le marqueur posé sur le membre d’une équipe',
    remplacements: [['    if (!membre && !entreeConfirmee) {\n', '    if (!entreeConfirmee) {\n']],
    scenario: 'un membre déjà dans l’équipe : 409, rien n’a changé, son mot de passe non plus',
  },
  {
    slug: 'create-team-member', quoi: 'l’adresse du client écrite au journal avant le refus',
    remplacements: [['    if (!membre && !entreeConfirmee) {\n', '    if (!membre && !entreeConfirmee) {\n      console.log("entrée à confirmer :", email)\n']],
    scenario: 'le client du dossier, la confirmation à false : 409, la phrase et son marqueur, personne n’entre',
  },
  {
    slug: 'create-team-member', quoi: 'la phrase qui dit que le compte est client d’un autre cabinet',
    remplacements: [[
      '"Ce compte ne peut pas entrer dans l\'équipe de ce cabinet, et rien n\'y a été changé.',
      '"Ce compte ne peut pas entrer dans l\'équipe de ce cabinet : il est client d\'un autre cabinet, et rien n\'y a été changé.',
    ]],
    scenario: 'un membre de son équipe, client d’un autre cabinet : 409, une phrase qui ne dit ni quel cabinet ni qu’il y est client, rien d’écrit, le compte intact',
  },
  // Le défaut 23.5 (10/10/2026) : « déjà inscrit » lu au STATUT. Le service rend 422 aussi pour un mot de passe que la
  // règle du projet refuse : la fonction cherchait alors un compte qui n'existe pas, puis disait « Un compte existe
  // déjà… ». Remis dans chacune des trois fonctions, il doit faire tomber le refus du mot de passe ; remis au MESSAGE, la
  // reconnaissance au code sous un message neutre ; et le refus du mot de passe oublié retombe sur le chemin d'avant.
  ...(['create-client-access', 'create-team-member'] as const).map((slug): DefautPlante => ({
    slug, quoi: '« déjà inscrit » de nouveau lu au statut 422',
    remplacements: [['} else if (adresseDejaInscrite(createError)) {', '} else if (createError?.status === 422) {']],
    scenario: 'le service refuse le mot de passe (une sorte de caractères manque) : 400, dit en français, aucun compte cherché, rien d’écrit',
  })),
  {
    slug: 'create-cabinet', quoi: '« déjà inscrit » de nouveau lu au statut 422',
    remplacements: [['    if (adresseDejaInscrite(createError)) {', '    if (createError?.status === 422) {']],
    scenario: 'le service refuse le mot de passe (une sorte de caractères manque) : 400, dit en français, aucun compte cherché, rien d’écrit',
  },
  {
    slug: 'create-client-access', quoi: '« déjà inscrit » de nouveau lu dans le message',
    remplacements: [['} else if (adresseDejaInscrite(createError)) {', '} else if (/already|exist|registered|duplicate/i.test(createError?.message ?? "")) {']],
    scenario: 'l’adresse déjà inscrite se reconnaît à son code (email_exists), sous un message que la fonction ne lit pas',
  },
  {
    slug: 'create-team-member', quoi: 'le refus du mot de passe oublié',
    remplacements: [['    if (refusMotDePasse !== null) return json({ error: refusMotDePasse }, 400)\n', '']],
    scenario: 'le service refuse le mot de passe (divulgué) : 400, dit en français, aucun compte cherché, rien d’écrit',
  },
  {
    slug: 'taux-change-bce', quoi: 'le préflight oublié',
    remplacements: [['  if (req.method === "OPTIONS") {\n    return new Response("ok", { headers: corsHeaders })\n  }\n', '']],
    scenario: 'le préflight du navigateur passe, sans rien demander à personne',
  },
  {
    slug: 'plateforme-agreee', quoi: 'le secret de la connexion rendu à l’écran',
    remplacements: [['    client_id: c.client_id,\n    organisation_id: c.organisation_id,', '    client_id: c.client_secret,\n    organisation_id: c.organisation_id,']],
    scenario: 'chef : le statut de la connexion, jamais son secret',
  },
  // LES FONCTIONS DE LA VENTE ACCEPTENT LE CLIENT (espace client, étape P3) : une régression de chaque sorte — le
  // contrôle retiré, une lecture avant lui, une action du cabinet ouverte au client, une base en panne prise pour un
  // accord, l'auteur d'une transmission oublié, le plafond d'e-mails relâché d'un cran ou compté sur le jour UTC.
  {
    slug: 'superpdp-credentials', quoi: 'le contrôle des droits retiré',
    remplacements: [['  if (!actionPermise(QUI_PEUT_QUOI, action, lus.droits)) {', '  if (false) {']],
    scenario: 'status — client du dossier sans droit : refusé (404) avant toute lecture, tout secret et toute dépense',
  },
  {
    slug: 'plateforme-agreee', quoi: 'la connexion (son secret) lue avant les droits',
    remplacements: [[
      '  const lus = await droitsDeLAppelant(supabaseAsCaller, dossierId)\n',
      '  await admin.from("connexions_plateformes").select(COLONNES).eq("dossier_id", dossierId).maybeSingle()\n  const lus = await droitsDeLAppelant(supabaseAsCaller, dossierId)\n',
    ]],
    scenario: 'statut — compte rattaché à rien : refusé (404) avant toute lecture, tout secret et toute dépense',
  },
  {
    slug: 'plateforme-agreee', quoi: 'la réception des achats ouverte au client « Ventes »',
    remplacements: [['  lister: "cabinet",', '  lister: "ventes",']],
    scenario: 'lister — client « Ventes » : refusé (404) avant toute lecture, tout secret et toute dépense',
  },
  {
    slug: 'superpdp-credentials', quoi: 'une base en panne prise pour un accord',
    remplacements: [[
      '      return { illisible: typeof message === "string" && message !== "" ? message : "erreur de la base" }',
      '      return { droits: { cabinet: true, membre: true, ventes: true, banque: true } }',
    ]],
    scenario: 'le contrôle des droits en panne : 503 qui le dit, rien de lu',
  },
  {
    slug: 'superpdp-emit', quoi: 'l’auteur de la transmission oublié',
    remplacements: [['        cree_par: callerData.user.id,\n', '']],
    scenario: 'client « Ventes » : sa facture part, et la transmission réservée porte son compte (cree_par)',
  },
  {
    slug: 'send-email', quoi: 'la relance de pièces ouverte au client',
    remplacements: [['  relance_pieces: "cabinet",', '  relance_pieces: "ventes",']],
    scenario: 'relance_pieces — client « Ventes » : refusé (404) avant toute lecture, tout secret et toute dépense',
  },
  {
    slug: 'send-email', quoi: 'le plafond relâché à trente et un',
    remplacements: [['const PLAFOND_CLIENT_PAR_JOUR = 30', 'const PLAFOND_CLIENT_PAR_JOUR = 31']],
    scenario: 'client « Ventes » : le 31e e-mail du jour est refusé (429) avant Resend, rien d’envoyé ni d’écrit',
  },
  {
    slug: 'send-email', quoi: 'le jour du plafond compté en UTC',
    remplacements: [[
      '    const jour = jourDeParis(Date.now())\n',
      '    const utc = new Date(Date.now()).toISOString().split("T")[0]\n    const jour = { debut: `${utc}T00:00:00.000Z`, fin: `${utc}T23:59:59.999Z` }\n',
    ]],
    scenario: 'le jour de Paris : trente e-mails partis avant minuit à Paris ne comptent plus après, même le même jour UTC',
  },
  // LE DÉPÔT QUI A ÉCHOUÉ (ligne 22.8) : chaque chemin de perte redevenu muet ; le doublon consigné comme une perte ; le
  // poids inventé, ou le poids lu jeté ; le nom du fichier rendu au journal par le détail de PostgREST ou le chemin d'un
  // orphelin ; le refus de la trace qui arrête la boucle ; la clé instable au rejeu ; la pièce jointe vide consignée.
  {
    slug: 'receive-email', quoi: 'la pièce jointe que Resend ne rend pas, sans trace',
    remplacements: [[
      '        console.error("Récupération pièce jointe échouée:", fichier.id, attachError)\n'
      + '        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", null)\n',
      '        console.error("Récupération pièce jointe échouée:", fichier.id, attachError)\n',
    ]],
    scenario: 'Resend ne rend pas la pièce jointe : un dépôt échoué au poids inconnu, consigné, et la suivante se dépose',
  },
  {
    slug: 'receive-email', quoi: 'le téléchargement raté, sans trace',
    remplacements: [[
      '        console.error("Téléchargement pièce jointe échoué:", fichier.id, res.status)\n'
      + '        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", null)\n',
      '        console.error("Téléchargement pièce jointe échoué:", fichier.id, res.status)\n',
    ]],
    scenario: 'le téléchargement de la pièce jointe échoue : un dépôt échoué au poids inconnu, consigné, rien au stockage',
  },
  {
    slug: 'receive-email', quoi: 'la recherche de doublon tombée, sans trace',
    remplacements: [[
      '(${erreurDoublon.message})`)\n        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)\n',
      '(${erreurDoublon.message})`)\n',
    ]],
    scenario: 'la détection de doublon tombe : la pièce jointe n’est pas déposée à l’aveugle, et le dépôt échoué se consigne avec son poids',
  },
  {
    slug: 'receive-email', quoi: 'le stockage refusé, sans trace',
    remplacements: [[
      '        console.error("Upload storage échoué:", fichier.id, uploadError)\n'
      + '        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)\n',
      '        console.error("Upload storage échoué:", fichier.id, uploadError)\n',
    ]],
    scenario: 'le stockage refuse le dépôt : le dépôt échoué se consigne avec le poids lu, rien d’inséré',
  },
  {
    slug: 'receive-email', quoi: 'l’insertion refusée, sans trace',
    remplacements: [[
      '        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)\n        continue\n      }\n\n      nbImportees++',
      '        continue\n      }\n\n      nbImportees++',
    ]],
    scenario: 'l’insertion de la pièce tombe : le fichier déposé est retiré du stockage, et le dépôt échoué se consigne avec son poids',
  },
  {
    slug: 'receive-email', quoi: 'l’exception, sans trace',
    remplacements: [[
      '      console.error("Erreur traitement pièce jointe:", fichier.id, err)\n'
      + '      await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)\n',
      '      console.error("Erreur traitement pièce jointe:", fichier.id, err)\n',
    ]],
    scenario: 'une exception après la lecture (l’insertion lève) : le dépôt échoué se consigne avec le poids lu',
  },
  {
    slug: 'receive-email', quoi: 'le doublon consigné comme un dépôt échoué',
    remplacements: [[
      '        console.log(`Pièce jointe déjà présente (hash identique), ignorée: ${fichier.id}`)\n',
      '        console.log(`Pièce jointe déjà présente (hash identique), ignorée: ${fichier.id}`)\n'
      + '        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)\n',
    ]],
    scenario: 'un doublon (même empreinte) : ni dépôt ni pièce',
  },
  {
    slug: 'receive-email', quoi: 'un poids inventé pour un dépôt échoué avant toute lecture',
    remplacements: [[
      'res.status)\n        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", null)',
      'res.status)\n        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", 1)',
    ]],
    scenario: 'le téléchargement de la pièce jointe échoue : un dépôt échoué au poids inconnu, consigné, rien au stockage',
  },
  {
    slug: 'receive-email', quoi: 'le poids lu jeté (un dépôt échoué consigné au poids inconnu)',
    remplacements: [[
      'uploadError)\n        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", octets)',
      'uploadError)\n        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "depot", null)',
    ]],
    scenario: 'le stockage refuse le dépôt : le dépôt échoué se consigne avec le poids lu, rien d’inséré',
  },
  {
    slug: 'receive-email', quoi: 'le détail de PostgREST — la ligne refusée — rendu au journal',
    remplacements: [[
      'console.error(`Insertion échouée: ${fichier.id} (${insertError.code || "sans code"} ${insertError.message})`)',
      'console.error("Insertion échouée:", fichier.id, insertError)',
    ]],
    scenario: 'l’insertion refusée avec le détail de la ligne, et le fichier qui ne se retire pas : le dépôt échoué se consigne, et le journal ne porte ni le nom ni les valeurs lues',
  },
  {
    slug: 'receive-email', quoi: 'le chemin du fichier orphelin, nom compris, rendu au journal',
    remplacements: [['stockage : ${dossier.id}/${horodatage}-… (${erreurRetrait.message})', 'stockage : ${path} (${erreurRetrait.message})']],
    scenario: 'l’insertion refusée avec le détail de la ligne, et le fichier qui ne se retire pas : le dépôt échoué se consigne, et le journal ne porte ni le nom ni les valeurs lues',
  },
  {
    slug: 'receive-email', quoi: 'le refus de la trace qui lève et arrête la boucle',
    remplacements: [[
      '    console.error(`[receive-email] pièce jointe écartée NON consignée (${raison}, ${octets === null ? "poids inconnu" : `${octets} octets`}) : ${erreur}`)\n',
      '    throw new Error(erreur)\n',
    ]],
    scenario: 'la base refuse la trace d’un dépôt échoué : le refus est journalisé sans nom, et la pièce jointe suivante se dépose',
  },
  {
    slug: 'receive-email', quoi: 'la clé d’idempotence instable, au rejeu d’un dépôt échoué',
    remplacements: [['JSON.stringify([emailId, pieceJointeId])', 'JSON.stringify([emailId, pieceJointeId, raison])']],
    scenario: 'Resend rejoue le webhook d’un dépôt échoué, lu cette fois et refusé à son format : rien de plus ne se consigne, sans erreur',
  },
  {
    slug: 'receive-email', quoi: 'la pièce jointe vide consignée comme un dépôt échoué',
    // Depuis la ligne 22.91, la pièce jointe vide se consigne sous sa raison : l'ancre est son appel.
    remplacements: [['fichier.id, "vide", 0)', 'fichier.id, "depot", null)']],
    scenario: 'une pièce jointe arrivée vide (0 octet) : consignée « vide » au poids zéro, journalisée sans son nom, ni déposée ni lue',
  },
  // LA PIÈCE JOINTE ARRIVÉE VIDE (ligne 22.91) : redevenue muette, consignée au poids inconnu, déposée après sa trace,
  // nommée au journal, ou instable au rejeu.
  {
    slug: 'receive-email', quoi: 'la pièce jointe vide redevenue sautée, sans trace',
    remplacements: [['        await noterLaPieceJointeEcartee(supabase, dossier.id, email_id, fichier.id, "vide", 0)\n', '']],
    scenario: 'une pièce jointe arrivée vide (0 octet) : consignée « vide » au poids zéro, journalisée sans son nom, ni déposée ni lue',
  },
  {
    slug: 'receive-email', quoi: 'la pièce jointe vide consignée au poids inconnu',
    remplacements: [['fichier.id, "vide", 0)', 'fichier.id, "vide", null)']],
    scenario: 'une pièce jointe arrivée vide (0 octet) : consignée « vide » au poids zéro, journalisée sans son nom, ni déposée ni lue',
  },
  {
    slug: 'receive-email', quoi: 'la pièce jointe vide déposée et lue après sa trace (la boucle continue)',
    remplacements: [['fichier.id, "vide", 0)\n        continue\n', 'fichier.id, "vide", 0)\n']],
    scenario: 'une pièce jointe arrivée vide (0 octet) : consignée « vide » au poids zéro, journalisée sans son nom, ni déposée ni lue',
  },
  {
    slug: 'receive-email', quoi: 'le nom de la pièce jointe vide au journal',
    remplacements: [['arrivée vide (0 octet) : ${fichier.id}`)', 'arrivée vide (0 octet) : ${fichier.id} ${fichier.filename}`)']],
    scenario: 'une pièce jointe arrivée vide (0 octet) : consignée « vide » au poids zéro, journalisée sans son nom, ni déposée ni lue',
  },
  {
    slug: 'receive-email', quoi: 'la clé d’idempotence instable, au rejeu d’une pièce jointe vide',
    remplacements: [['JSON.stringify([emailId, pieceJointeId])', 'JSON.stringify([emailId, pieceJointeId, crypto.randomUUID()])']],
    scenario: 'Resend rejoue le webhook d’une pièce jointe arrivée vide : rien de plus ne se consigne, sans erreur',
  },
  // LES ÉLÉMENTS QUI NE SONT PAS DES PIÈCES JOINTES, COMPTÉS AU JOURNAL (ligne 22.92) : un compte qui oublie les PDF
  // « inline » ou lit le type sans sa casse ni ses paramètres, qui range l'absence en « autre » ou compte les vraies
  // pièces jointes ; un nom, un type tel quel ou l'objet de l'e-mail au journal ; la ligne disparue, ou écrite pour une
  // adresse inconnue ; et les éléments intégrés téléchargés par un filtre élargi.
  {
    slug: 'receive-email', quoi: 'le compte oublie les PDF « inline »',
    remplacements: [['if (type === "application/pdf") return "pdf"', 'if (type === "application/x-pdf") return "pdf"']],
    scenario: 'des éléments intégrés au corps de l’e-mail : comptés au journal sans nom, ni lus ni déposés ; la pièce jointe se dépose comme avant',
  },
  {
    slug: 'receive-email', quoi: 'le type déclaré lu sans sa casse ni ses paramètres',
    remplacements: [['const type = brut.split(";")[0].trim().toLowerCase()', 'const type = brut']],
    scenario: 'des éléments intégrés au corps de l’e-mail : comptés au journal sans nom, ni lus ni déposés ; la pièce jointe se dépose comme avant',
  },
  {
    slug: 'receive-email', quoi: 'la disposition absente rangée en « autre »',
    remplacements: [['if (brute === undefined || brute === null || brute === "") return "aucune"', 'if (brute === null) return "aucune"']],
    scenario: 'un e-mail d’éléments intégrés seulement : comptés au journal, et rien de lu chez Resend, de téléchargé ni d’écrit',
  },
  {
    slug: 'receive-email', quoi: 'le compte pris sur toutes les pièces jointes (les vraies comptées)',
    remplacements: [['    if (e.content_disposition === "attachment") continue\n', '']],
    scenario: 'des éléments intégrés au corps de l’e-mail : comptés au journal sans nom, ni lus ni déposés ; la pièce jointe se dépose comme avant',
  },
  {
    slug: 'receive-email', quoi: 'un nom de fichier au journal du compte',
    remplacements: [[
      '${compteDesElementsIntegres(attachments ?? [])}`)',
      '${compteDesElementsIntegres(attachments ?? [])} ${(attachments ?? []).map((a) => a.filename).join(", ")}`)',
    ]],
    scenario: 'un e-mail d’éléments intégrés seulement : comptés au journal, et rien de lu chez Resend, de téléchargé ni d’écrit',
  },
  {
    slug: 'receive-email', quoi: 'le type déclaré recopié tel quel au journal (il porte le nom du fichier)',
    remplacements: [[
      '${compteDesElementsIntegres(attachments ?? [])}`)',
      '${compteDesElementsIntegres(attachments ?? [])} ${(attachments ?? []).map((a) => a.content_type).join(", ")}`)',
    ]],
    scenario: 'des éléments intégrés au corps de l’e-mail : comptés au journal sans nom, ni lus ni déposés ; la pièce jointe se dépose comme avant',
  },
  {
    slug: 'receive-email', quoi: 'l’objet de l’e-mail ajouté à la ligne du compte',
    remplacements: [['${compteDesElementsIntegres(attachments ?? [])}`)', '${compteDesElementsIntegres(attachments ?? [])} ("${subject}")`)']],
    scenario: 'un e-mail sans élément hors pièces jointes : le compte au journal dit zéro',
  },
  {
    slug: 'receive-email', quoi: 'la ligne du compte disparue',
    remplacements: [['  console.log(`[receive-email] dossier ${dossier.id} : ${compteDesElementsIntegres(attachments ?? [])}`)\n', '']],
    scenario: 'un e-mail sans élément hors pièces jointes : le compte au journal dit zéro',
  },
  {
    slug: 'receive-email', quoi: 'le compte écrit pour une adresse inconnue',
    remplacements: [[
      '    console.warn(`[receive-email] adresse de collecte inconnue : e-mail ${email_id}, ${to.length} destinataire(s), ${(attachments ?? []).length} fichier(s) joint(s)`)\n',
      '    console.warn(`[receive-email] adresse de collecte inconnue : e-mail ${email_id}, ${to.length} destinataire(s), ${(attachments ?? []).length} fichier(s) joint(s)`)\n'
      + '    console.log(`[receive-email] dossier inconnu : ${compteDesElementsIntegres(attachments ?? [])}`)\n',
    ]],
    scenario: 'une adresse que nul dossier ne porte, avec des éléments intégrés : rien de compté — le compte est celui d’un dossier connu',
  },
  {
    slug: 'receive-email', quoi: 'les éléments intégrés téléchargés (le filtre des pièces jointes élargi)',
    remplacements: [[
      '(attachments ?? []).filter((a) => a.content_disposition === "attachment")',
      '(attachments ?? []).filter((a) => a.content_disposition !== "inline")',
    ]],
    scenario: 'un e-mail d’éléments intégrés seulement : comptés au journal, et rien de lu chez Resend, de téléchargé ni d’écrit',
  },
  // LE JOURNAL NE PORTE QUE DES COMPTES (23-journalEmail) : l'objet et l'expéditeur de l'adresse inconnue, son code, la
  // liste brute des destinataires, l'objet du bilan, l'erreur de la base recopiée entière — chacun posé tel qu'il était.
  {
    slug: 'receive-email', quoi: 'l’objet et l’expéditeur à nouveau recopiés à la ligne de l’adresse inconnue',
    remplacements: [
      ['  const { email_id, to, attachments } = event.data', '  const { email_id, to, from, subject, attachments } = event.data'],
      [
        '    console.warn(`[receive-email] adresse de collecte inconnue : e-mail ${email_id}, ${to.length} destinataire(s), ${(attachments ?? []).length} fichier(s) joint(s)`)\n',
        '    console.warn(`[receive-email] adresse de collecte inconnue : e-mail ${email_id}, de ${from}, sujet "${subject}"`)\n',
      ],
    ],
    scenario: 'une adresse que nul dossier ne porte : le journal la dit inconnue et compte destinataires et fichiers — ni l’objet, ni l’expéditeur, ni l’adresse, ni son code',
  },
  {
    slug: 'receive-email', quoi: 'le code de collecte à nouveau recopié à la ligne de l’adresse inconnue',
    remplacements: [[
      '    console.warn(`[receive-email] adresse de collecte inconnue : e-mail ${email_id}, ${to.length}',
      '    console.warn(`[receive-email] adresse de collecte inconnue : "${codeEmail}", e-mail ${email_id}, ${to.length}',
    ]],
    scenario: 'une adresse que nul dossier ne porte : le journal la dit inconnue et compte destinataires et fichiers — ni l’objet, ni l’expéditeur, ni l’adresse, ni son code',
  },
  {
    slug: 'receive-email', quoi: 'la liste brute des destinataires à nouveau rendue au journal',
    remplacements: [[
      '    console.error(`[receive-email] aucun destinataire exploitable : ${to.length} destinataire(s) reçu(s), e-mail ${email_id}`)',
      '    console.error("Aucun destinataire exploitable:", to)',
    ]],
    scenario: 'un e-mail sans destinataire exploitable : le journal compte les destinataires — ni leur adresse ni leur nom affiché',
  },
  {
    slug: 'receive-email', quoi: 'l’objet de l’e-mail remis à la ligne de bilan',
    remplacements: [
      ['  const { email_id, to, attachments } = event.data', '  const { email_id, to, subject, attachments } = event.data'],
      [
        '  console.log(`E-mail ${email_id} → dossier ${dossier.id} : ${nbImportees}/${fichiers.length} pièce(s) importée(s)`)',
        '  console.log(`E-mail ${email_id} ("${subject}") → dossier ${dossier.id} : ${nbImportees}/${fichiers.length} pièce(s) importée(s)`)',
      ],
    ],
    scenario: 'un e-mail sans élément hors pièces jointes : le compte au journal dit zéro',
  },
  {
    slug: 'receive-email', quoi: 'l’erreur de la base recopiée entière au journal (son détail porte le code de collecte)',
    remplacements: [[
      '    console.error(`[receive-email] lecture du dossier refusée (${dossierError.code || "sans code"} ${dossierError.message})`)',
      '    console.error(dossierError)',
    ]],
    scenario: 'la lecture du dossier tombe : 500, et le journal en dit le message de la base — rien de l’adresse',
  },
  {
    slug: 'receive-email', quoi: 'la ligne de bilan disparue',
    remplacements: [[
      '  console.log(`E-mail ${email_id} → dossier ${dossier.id} : ${nbImportees}/${fichiers.length} pièce(s) importée(s)`)\n', '',
    ]],
    scenario: 'un e-mail sans élément hors pièces jointes : le compte au journal dit zéro',
  },
  // UN MOT DE PASSE DE PLUS DE 72 OCTETS (23-Q5), dans chacune des trois fonctions qui créent des comptes : le contrôle
  // oublié, compté en caractères, ou décalé d'un octet de part et d'autre.
  ...['create-cabinet', 'create-team-member', 'create-client-access'].flatMap((slug): DefautPlante[] => {
    const controle = '  if (new TextEncoder().encode(password).length > 72) {'
    return [
      {
        slug, quoi: 'le maximum des 72 octets oublié',
        remplacements: [[controle, '  if (false) {']],
        scenario: 'un mot de passe de plus de 72 octets (84) : 400 en français avant tout appel au service, rien d’écrit, aucun compte cherché',
      },
      {
        slug, quoi: 'le maximum compté en caractères et non en octets',
        remplacements: [[controle, '  if (password.length > 72) {']],
        scenario: 'un mot de passe de 39 caractères mais 74 octets : les lettres accentuées en pèsent deux : 400 en français avant tout appel au service, rien d’écrit, aucun compte cherché',
      },
      {
        slug, quoi: 'le maximum décalé d’un octet vers le bas (72 refusé)',
        remplacements: [[controle, '  if (new TextEncoder().encode(password).length > 71) {']],
        scenario: 'un mot de passe de 72 octets n’est pas refusé par la fonction : il atteint le service',
      },
      {
        slug, quoi: 'le maximum décalé d’un octet vers le haut (73 admis)',
        remplacements: [[controle, '  if (new TextEncoder().encode(password).length > 73) {']],
        scenario: 'un mot de passe de 73 octets, un de trop : 400 en français avant tout appel au service, rien d’écrit, aucun compte cherché',
      },
    ]
  }),
]

describe.each(DEFAUTS_PLANTES.map((d) => [`${d.slug} : ${d.quoi}`, d] as const))('défaut planté — %s', (_nom, defaut) => {
  const contrat = CONTRATS.find((c) => c.slug === defaut.slug)!
  let mutee = ''
  beforeAll(() => {
    // L'ancre se pose une fois, ou la mutation est à réécrire : `muter` lève.
    mutee = muter(sourceDe(defaut.slug), defaut.remplacements)
    for (const s of [defaut.slug, ...(contrat.voisines ?? [])]) prechauffer(sourceDe(s))
    prechauffer(mutee)
  })

  it('les juges le voient — et ne voient rien sur la vraie source', async () => {
    const scenario = contrat.scenarios.find((s) => s.nom === defaut.scenario)
    expect(scenario, `scénario « ${defaut.scenario} » introuvable`).toBeDefined()
    expect(await jugerScenario(contrat, scenario!, contexte)).toEqual([])
    const fautes = await jugerScenario(contrat, scenario!, contexte, mutee)
    expect(fautes.length, 'le défaut planté est passé inaperçu').toBeGreaterThan(0)
  })
})
