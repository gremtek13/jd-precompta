import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { poids, TAILLE_MAX_PIECE } from './bornesStockage'
import type { ReponseDeLaBase } from './couvertureReleve'
import { motsDuCabinet } from './espaceVentes'
import * as cabinet from './piecesJointesEcartees'
import {
  ACCUEIL_VERIFICATION_IMPOSSIBLE, CE_QUE_DIT_LA_COLLECTE, ceQueDitLaCollecte, ceQueTuPeuxFaire, dOuEllesViennent, ECARTEES_DU_CLIENT_EXPORTEES,
  ECARTEES_EN_LECTURE, JOURS_DE_LA_LECTURE_DU_CLIENT, lectureDesEcarteesDuClient, lignesDuClient, lireLesEcarteesDuClient,
  ouRenvoyer, phraseDeLaRaison, quandPourLeClient, SI_LA_LECTURE_MANQUE, titreDuSignalement, VOIR_DANS_MES_PIECES,
} from './piecesJointesEcarteesClient'
import type { PieceJointeEcarteeDuClient } from './types'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// CE QUE « MES PIÈCES » DIT AU CLIENT D'UNE PIÈCE JOINTE ÉCARTÉE (ligne 22.9). Ce qui se garde ici : une réponse de la
// base qu'on ne sait pas lire ne passe jamais pour « rien d'écarté » ; les phrases sont celles du client (tutoiement,
// aucun onglet, jamais « le client » pour lui) et chaque raison garde sa consigne ; le combien et le pourquoi sont ceux de
// l'onglet Justificatifs, partagés et non recopiés ; la phrase de l'onglet Accès dit ce que la base ouvre, aux deux états
// du drapeau ; et le drapeau dit ce que porte l'export — le jour où la migration y entre, ce fichier vire au rouge tant
// qu'il reste faux. Données FICTIVES.

const ligne = (o: Partial<PieceJointeEcarteeDuClient> = {}): PieceJointeEcarteeDuClient => ({
  jour: '2026-10-12', raison: 'format', octets: 4120, ...o,
})
const OU = 'dans « Déposer des fichiers », ci-dessous, ou par e-mail, à la même adresse'
const BORNE = poids(TAILLE_MAX_PIECE)
// Sans adresse lue (l'état d'avant la ligne 22.93, et celui d'une lecture ratée ou pas revenue) : « la même adresse ».
const peutFaire = (lignes: readonly Pick<PieceJointeEcarteeDuClient, 'raison'>[]) => ceQueTuPeuxFaire(lignes, null)
// Une adresse fictive, de la forme que compose `adresseDeCollecte`.
const ADRESSE = 'dossier-fictif-3f9a2c@precompta.jdarnis.fr'

// Une requête comme PostgREST en construit une : un `then` qui ne rend rien (le patron de couvertureReleve.test.ts).
function requete(reponse: () => ReponseDeLaBase): PromiseLike<ReponseDeLaBase> {
  const objet = {
    then(suite: (r: ReponseDeLaBase) => unknown, echec?: (e: unknown) => unknown) {
      Promise.resolve().then(reponse).then(suite, echec)
      return undefined
    },
  }
  return objet as unknown as PromiseLike<ReponseDeLaBase>
}

describe('la réponse de la base : un tableau de { jour, raison, octets }, et rien d’autre', () => {
  it('rend chaque élément, dans l’ordre de la base, et seulement ses trois champs', () => {
    expect(lignesDuClient([
      { jour: '2026-10-12', raison: 'format', octets: 4120 },
      { jour: '2026-10-11', raison: 'depot', octets: null },
      { jour: '2026-07-15', raison: 'vide', octets: 0 },
      // Un champ de plus, s'il en venait un, n'est jamais repris.
      { jour: '2026-07-14', raison: 'taille', octets: 26_214_400, vue_par: 'u-cabinet' },
    ])).toEqual([
      { jour: '2026-10-12', raison: 'format', octets: 4120 },
      { jour: '2026-10-11', raison: 'depot', octets: null },
      { jour: '2026-07-15', raison: 'vide', octets: 0 },
      { jour: '2026-07-14', raison: 'taille', octets: 26_214_400 },
    ])
    expect(lignesDuClient([])).toEqual([])
  })

  it('toute autre forme est illisible — ni une liste vide, ni une liste plus courte', () => {
    for (const rendu of [
      null, undefined, {}, '[]', 3,
      [null], [[]], ['2026-10-12'],
      [{ raison: 'format', octets: 1 }],
      [{ jour: '12/10/2026', raison: 'format', octets: 1 }],
      [{ jour: '2026-02-30', raison: 'format', octets: 1 }],
      [{ jour: '2026-13-01', raison: 'format', octets: 1 }],
      [{ jour: '2026-10-12T00:00:00Z', raison: 'format', octets: 1 }],
      [{ jour: '2026-10-12', raison: 'autre', octets: 1 }],
      [{ jour: '2026-10-12', octets: 1 }],
      [{ jour: '2026-10-12', raison: 'format', octets: -1 }],
      [{ jour: '2026-10-12', raison: 'format', octets: 1.5 }],
      [{ jour: '2026-10-12', raison: 'format', octets: '4120' }],
      [{ jour: '2026-10-12', raison: 'format' }],
      [{ jour: '2026-10-12', raison: 'format', octets: 1 }, 'de trop'],
    ]) {
      expect(lignesDuClient(rendu), JSON.stringify(rendu) ?? String(rendu)).toBeNull()
    }
  })

  it('un refus, une réponse illisible ou une requête qui lève se SIGNALENT, sans ligne', async () => {
    expect(lectureDesEcarteesDuClient({ data: [ligne()], error: null })).toEqual({ lignes: [ligne()], complete: true, motif: null })
    expect(lectureDesEcarteesDuClient({ data: [], error: null })).toEqual({ lignes: [], complete: true, motif: null })
    expect(lectureDesEcarteesDuClient({ data: null, error: { message: 'Accès refusé à ce dossier.' } }))
      .toEqual({ lignes: [], complete: false, motif: 'lecture refusée : Accès refusé à ce dossier.' })
    expect(lectureDesEcarteesDuClient({ data: { jour: '2026-10-12' }, error: null }))
      .toEqual({ lignes: [], complete: false, motif: 'réponse illisible' })
    // Une donnée lisible accompagnée d'une erreur est un refus : l'erreur l'emporte.
    expect(lectureDesEcarteesDuClient({ data: [ligne()], error: { message: 'refus' } }).complete).toBe(false)

    // La requête est ATTENDUE : un constructeur de requête n'est pas une promesse — son `then` ne rend rien, comme celui
    // de la doublure qui retient les réponses (src/test/clientRetenu.ts) ; seul `await` en reçoit la réponse.
    expect(await lireLesEcarteesDuClient(requete(() => ({ data: [ligne()], error: null }))))
      .toEqual({ lignes: [ligne()], complete: true, motif: null })
    expect(await lireLesEcarteesDuClient(requete(() => { throw new Error('réseau coupé') })))
      .toEqual({ lignes: [], complete: false, motif: 'lecture impossible : réseau coupé' })
  })
})

describe('quand, pourquoi, combien — les mots de l’onglet Justificatifs, partagés et non recopiés', () => {
  it('le combien et le pourquoi SONT ceux du module du cabinet', () => {
    expect(phraseDeLaRaison).toBe(cabinet.phraseDeLaRaison)
    expect(titreDuSignalement).toBe(cabinet.titreDuSignalement)
    expect(titreDuSignalement(1)).toBe('1 pièce jointe reçue par e-mail n’a pas été déposée')
    expect(phraseDeLaRaison(ligne({ raison: 'depot', octets: null }))).toBe('le dépôt a échoué avant toute lecture de la pièce jointe (poids inconnu)')
    expect(phraseDeLaRaison(ligne({ raison: 'vide', octets: 0 }))).toBe('arrivée vide (0 octet)')
  })

  // Une date civile n'a pas de fuseau : le jour que la base a calculé à Paris se dit tel quel, où que soit le téléphone.
  const fuseau = process.env.TZ
  afterEach(() => { process.env.TZ = fuseau })
  it.each(['Europe/Paris', 'UTC', 'America/New_York', 'Pacific/Auckland'])('le jour se dit tel que la base le rend (%s)', (tz) => {
    process.env.TZ = tz
    expect(quandPourLeClient('2026-10-12')).toBe('le 12/10/2026')
    expect(quandPourLeClient('2026-01-01')).toBe('le 01/01/2026')
  })

  it('d’où elles viennent, sur quelle durée, que le cabinet les voit, et pourquoi aucun nom — au singulier et au pluriel', () => {
    expect(dOuEllesViennent(1)).toBe('Reçue à l’adresse de collecte de ton dossier ces 90 derniers jours ; ton cabinet la voit aussi. '
      + 'Son nom n’est pas gardé : le jour et le poids t’aident à retrouver l’e-mail.')
    expect(dOuEllesViennent(3)).toBe('Reçues à l’adresse de collecte de ton dossier ces 90 derniers jours ; ton cabinet les voit aussi. '
      + 'Leur nom n’est pas gardé : le jour et le poids t’aident à retrouver l’e-mail.')
    expect(JOURS_DE_LA_LECTURE_DU_CLIENT).toBe(90)
  })
})

describe('ce que le client peut faire : chaque raison garde sa consigne', () => {
  const reste1 = 'Cette liste ne sait pas si tu l’as renvoyée depuis : si c’est fait, tu n’as rien à faire.'
  const resteN = 'Cette liste ne sait pas si tu les as renvoyées depuis : si c’est fait, tu n’as rien à faire.'
  const pasUnePiece = 'Une pièce jointe qui n’était pas une pièce — une signature électronique, une invitation… — n’a pas à être renvoyée.'

  it('refusées à leur format ou à leur poids : autrement, en PDF, JPEG, PNG ou CSV, et sous la borne', () => {
    expect(peutFaire([ligne({ raison: 'taille' })])).toEqual([
      `Pour qu’elle arrive, renvoie-la en PDF, JPEG, PNG ou CSV, et sous ${BORNE} — ${OU}.`, reste1,
    ])
    // Un format refusé peut n'avoir jamais été une pièce : il n'a rien à faire.
    expect(peutFaire([ligne(), ligne({ raison: 'taille' })])).toEqual([
      `Pour qu’elles arrivent, renvoie-les en PDF, JPEG, PNG ou CSV, et sous ${BORNE} chacune — ${OU}.`, pasUnePiece, resteN,
    ])
    expect(BORNE).toBe('20 Mo')
  })

  it('le dépôt a échoué : ce n’est pas de son fait, TELLE QUELLE', () => {
    expect(peutFaire([ligne({ raison: 'depot', octets: null })])).toEqual([
      `Ce n’est pas de ton fait : renvoie-la telle quelle — ${OU}.`, reste1,
    ])
    expect(peutFaire([ligne({ raison: 'depot' }), ligne({ raison: 'depot', octets: null })])).toEqual([
      `Ce n’est pas de ton fait : renvoie-les telles quelles — ${OU}.`, resteN,
    ])
  })

  it('arrivée vide : vérifier son fichier d’abord — jamais « telle quelle », qui la ferait arriver vide de nouveau', () => {
    expect(peutFaire([ligne({ raison: 'vide', octets: 0 })])).toEqual([
      `Vérifie ton fichier (qu’il s’ouvre et ne soit pas vide), puis renvoie-le — ${OU}.`, reste1,
    ])
    expect(peutFaire([ligne({ raison: 'vide', octets: 0 }), ligne({ raison: 'vide', octets: 0 })])).toEqual([
      `Vérifie tes fichiers (qu’ils s’ouvrent et ne soient pas vides), puis renvoie-les — ${OU}.`, resteN,
    ])
    expect(peutFaire([ligne({ raison: 'vide', octets: 0 })]).join(' ')).not.toMatch(/telle quelle/)
  })

  it('mêlées : chacune sa consigne, puis où les renvoyer', () => {
    expect(peutFaire([ligne(), ligne({ raison: 'depot', octets: null }), ligne({ raison: 'vide', octets: 0 })])).toEqual([
      `Celle refusée à son format ou à son poids : renvoie-la en PDF, JPEG, PNG ou CSV, et sous ${BORNE}.`,
      'Celle dont le dépôt a échoué : ce n’est pas de ton fait, renvoie-la telle quelle.',
      'Celle arrivée vide : vérifie ton fichier (qu’il s’ouvre et ne soit pas vide) avant de le renvoyer.',
      `Renvoie-les ${OU}.`,
      pasUnePiece,
      resteN,
    ])
    expect(peutFaire([
      ligne({ raison: 'taille' }), ligne({ raison: 'taille' }), ligne({ raison: 'depot' }), ligne({ raison: 'depot' }),
      ligne({ raison: 'vide', octets: 0 }), ligne({ raison: 'vide', octets: 0 }),
    ])).toEqual([
      `Celles refusées à leur format ou à leur poids : renvoie-les en PDF, JPEG, PNG ou CSV, et sous ${BORNE} chacune.`,
      'Celles dont le dépôt a échoué : ce n’est pas de ton fait, renvoie-les telles quelles.',
      'Celles arrivées vides : vérifie tes fichiers (qu’ils s’ouvrent et ne soient pas vides) avant de les renvoyer.',
      `Renvoie-les ${OU}.`,
      resteN,
    ])
    // Deux raisons seulement : le groupe absent ne se dit pas.
    expect(peutFaire([ligne({ raison: 'depot' }), ligne({ raison: 'vide', octets: 0 })])).toEqual([
      'Celle dont le dépôt a échoué : ce n’est pas de ton fait, renvoie-la telle quelle.',
      'Celle arrivée vide : vérifie ton fichier (qu’il s’ouvre et ne soit pas vide) avant de le renvoyer.',
      `Renvoie-les ${OU}.`,
      resteN,
    ])
    expect(peutFaire([])).toEqual([])
  })

  it('l’adresse lue est NOMMÉE à la place de « la même adresse », dans chaque phrase qui dit où renvoyer — et nulle part ailleurs', () => {
    const ou = `dans « Déposer des fichiers », ci-dessous, ou par e-mail, à ${ADRESSE}`
    expect(ouRenvoyer(ADRESSE)).toBe(ou)
    expect(ouRenvoyer(null)).toBe(OU)
    expect(ceQueTuPeuxFaire([ligne({ raison: 'taille' })], ADRESSE)).toEqual([
      `Pour qu’elle arrive, renvoie-la en PDF, JPEG, PNG ou CSV, et sous ${BORNE} — ${ou}.`, reste1,
    ])
    expect(ceQueTuPeuxFaire([ligne({ raison: 'depot', octets: null }), ligne({ raison: 'depot' })], ADRESSE)).toEqual([
      `Ce n’est pas de ton fait : renvoie-les telles quelles — ${ou}.`, resteN,
    ])
    expect(ceQueTuPeuxFaire([ligne({ raison: 'vide', octets: 0 })], ADRESSE)).toEqual([
      `Vérifie ton fichier (qu’il s’ouvre et ne soit pas vide), puis renvoie-le — ${ou}.`, reste1,
    ])
    // Mêlées : la phrase commune, et elle seule, dit où.
    const melees = ceQueTuPeuxFaire([ligne(), ligne({ raison: 'depot', octets: null })], ADRESSE)
    expect(melees).toContain(`Renvoie-les ${ou}.`)
    for (const cas of [[ligne()], [ligne(), ligne({ raison: 'depot' }), ligne({ raison: 'vide', octets: 0 })]]) {
      const phrases = ceQueTuPeuxFaire(cas, ADRESSE)
      expect(phrases.join(' ').split(ADRESSE)).toHaveLength(2)
      expect(phrases.join(' ')).not.toContain('la même adresse')
    }
    // Sans adresse, rien n'est inventé : les phrases d'avant, au caractère près.
    expect(ceQueTuPeuxFaire([ligne()], null).join(' ')).not.toMatch(/@/)
  })

  it('aucun texte montré au client ne parle comme le cabinet : ni onglet, ni « le client », ni vouvoiement', () => {
    const raisons: PieceJointeEcarteeDuClient['raison'][] = ['format', 'taille', 'depot', 'vide']
    const textes = [ECARTEES_EN_LECTURE, SI_LA_LECTURE_MANQUE, dOuEllesViennent(1), dOuEllesViennent(2), quandPourLeClient('2026-10-12'),
      titreDuSignalement(1), titreDuSignalement(2),
      ...raisons.flatMap((r) => [phraseDeLaRaison({ raison: r, octets: r === 'vide' ? 0 : 4120 }), phraseDeLaRaison({ raison: r, octets: null })])]
    // Toutes les combinaisons de zéro, une ou deux lignes de chaque raison.
    for (const n of [0, 1, 2]) for (const t of [0, 1, 2]) for (const d of [0, 1, 2]) for (const v of [0, 1, 2]) {
      const lignes = [
        ...Array.from({ length: n }, () => ligne()), ...Array.from({ length: t }, () => ligne({ raison: 'taille' })),
        ...Array.from({ length: d }, () => ligne({ raison: 'depot', octets: null })),
        ...Array.from({ length: v }, () => ligne({ raison: 'vide', octets: 0 })),
      ]
      textes.push(...peutFaire(lignes), ...ceQueTuPeuxFaire(lignes, ADRESSE))
    }
    for (const texte of textes) expect(motsDuCabinet(texte), texte).toEqual([])
    // Le garde des ventes laisse passer « le client », qu'il réserve à l'ACHETEUR : ici, il n'y a pas d'acheteur, et le mot
    // ne désignerait que le titulaire — aucun texte ne le porte.
    for (const texte of textes) expect(texte, texte).not.toMatch(/\bclients?\b/i)
    // Et les deux règles voient ce qu'elles gardent : la phrase de l'onglet Accès nomme un onglet, celle de l'onglet
    // Justificatifs nomme « le client ».
    expect(motsDuCabinet(ceQueDitLaCollecte(false)).length).toBeGreaterThan(0)
    expect(cabinet.ceQueLeCabinetPeutFaire([{ raison: 'format' }])).toMatch(/\bclients?\b/i)
  })
})

describe('l’accueil du client (ligne 22.94) : une ligne qui signale et renvoie à « Mes pièces »', () => {
  it('les phrases neuves sont celles du client, et renvoient à « Mes pièces » sans rien dire de la carte', () => {
    for (const texte of [VOIR_DANS_MES_PIECES, ACCUEIL_VERIFICATION_IMPOSSIBLE]) {
      expect(motsDuCabinet(texte), texte).toEqual([])
      expect(texte, texte).toContain('« Mes pièces »')
      expect(texte, texte).not.toMatch(/\bclients?\b/i)
    }
    // Ni raison, ni jour, ni poids, ni adresse : la carte de « Mes pièces » les dit.
    expect(ACCUEIL_VERIFICATION_IMPOSSIBLE).not.toMatch(/\d|@|format|taille|vide/)
    // La vérification manquée ne se confond ni avec le signalement ni avec un vide : elle dit qu'elle n'a pas pu se faire.
    expect(ACCUEIL_VERIFICATION_IMPOSSIBLE).toMatch(/n’ont pas pu être vérifiées/)
    expect(ACCUEIL_VERIFICATION_IMPOSSIBLE).not.toBe(titreDuSignalement(1))
  })

  it('la lecture s’écrit UNE fois : un seul `.rpc(` de la fonction dans la source, et il est dans le crochet partagé', () => {
    const racine = new URL('../', import.meta.url)
    const trouves: string[] = []
    const parcourir = (dossier: URL, prefixe: string) => {
      for (const entree of readdirSync(dossier, { withFileTypes: true })) {
        if (entree.name === 'test') continue
        const suivant = new URL(`${entree.name}${entree.isDirectory() ? '/' : ''}`, dossier)
        if (entree.isDirectory()) { parcourir(suivant, `${prefixe}${entree.name}/`); continue }
        if (!/\.tsx?$/.test(entree.name) || /\.test\.tsx?$/.test(entree.name)) continue
        // Les commentaires citent l'appel (« lireLesEcarteesDuClient(supabase.rpc('…') ») : seules les lignes de code comptent.
        const code = readFileSync(suivant, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
        if (/rpc\(\s*'pieces_jointes_ecartees_du_client'/.test(code)) trouves.push(`${prefixe}${entree.name}`)
      }
    }
    parcourir(racine, '')
    expect(trouves).toEqual(['lib/piecesJointesEcarteesClientLecture.ts'])
    // Et les deux écrans du client l'appellent par ce crochet.
    for (const ecran of ['../pages/ClientHome.tsx', '../pages/ClientUpload.tsx']) {
      expect(readFileSync(new URL(ecran, import.meta.url), 'utf8'), ecran).toMatch(/useEcarteesDuClient\(dossierId\)/)
    }
  })
})

describe('la phrase de l’onglet Accès sur la collecte (S229-Q5) : ce que la base ouvre, aux deux états du drapeau', () => {
  const arrivent = `Les pièces jointes reçues — en PDF, JPEG, PNG ou CSV, de ${BORNE} au plus chacune — arrivent directement en pièces à valider.`
  const ecartees = 'Celle qui n’est pas déposée — d’un autre format, plus lourde, arrivée vide, ou dont le dépôt a échoué — se dit dans l’onglet Justificatifs, sans son nom'

  it('drapeau baissé : les quatre raisons et l’onglet Justificatifs, et rien du client', () => {
    expect(ceQueDitLaCollecte(false)).toBe(`${arrivent} ${ecartees}.`)
    expect(ceQueDitLaCollecte(false)).not.toMatch(/Mes pièces/)
  })

  it('drapeau levé : et ce que tout accès client lit dans « Mes pièces », sur quelle durée, sans nom', () => {
    expect(ceQueDitLaCollecte(true)).toBe(`${arrivent} ${ecartees} ; tout accès client du dossier, avec ou sans case, la voit aussi dans `
      + '« Mes pièces » pendant 90 jours : le jour, la raison et le poids, jamais le nom.')
  })

  it('la phrase de l’onglet est celle de l’état d’aujourd’hui', () => {
    expect(CE_QUE_DIT_LA_COLLECTE).toBe(ceQueDitLaCollecte(ECARTEES_DU_CLIENT_EXPORTEES))
  })
})

describe('le drapeau dit ce que porte l’export', () => {
  it('ECARTEES_DU_CLIENT_EXPORTEES si et seulement si l’export porte la fonction — et alors, sa forme est celle qu’on lit', () => {
    const exportee = fichiersDuSchema().some((f) => /create (or replace )?function public\.pieces_jointes_ecartees_du_client\(/.test(f.texte))
    expect(exportee, 'ECARTEES_DU_CLIENT_EXPORTEES ne dit plus ce que porte l’export').toBe(ECARTEES_DU_CLIENT_EXPORTEES)
    if (!exportee) return
    const sql = derniereDefinitionSql('pieces_jointes_ecartees_du_client')
    // Le paramètre que l'écran envoie, une seule valeur en retour.
    expect(sql).toMatch(/pieces_jointes_ecartees_du_client\(p_dossier_id uuid\) returns jsonb/)
    // Tout accès client du dossier, avec ou sans case — et le cabinet.
    expect(sql).toContain("public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'membre')")
    // La fenêtre que l'écran dit.
    expect(sql).toContain(`e.recue_le >= now() - interval '${JOURS_DE_LA_LECTURE_DU_CLIENT} days'`)
    // Les trois champs que `lignesDuClient` lit, et eux seuls ; le jour à Paris.
    expect([...sql.matchAll(/'(\w+)', \(?e\./g)].map((m) => m[1])).toEqual(['jour', 'raison', 'octets'])
    expect(sql).toContain("'jour', (e.recue_le at time zone 'Europe/Paris')::date")
    expect(sql).toContain('order by e.recue_le desc, e.id')
    expect(sql).toContain("'[]'::jsonb")
    const SCHEMA = new URL('../../supabase/schema/', import.meta.url)
    const noms = readdirSync(SCHEMA).filter((nom) => /^\d{14}_pieces_jointes_ecartees_au_client\.sql$/.test(nom))
    expect(noms, 'la migration pieces_jointes_ecartees_au_client doit être UNE dans l’export').toHaveLength(1)
    const migration = readFileSync(new URL(noms[0], SCHEMA), 'utf8')
    expect(migration).toContain('revoke execute on function public.pieces_jointes_ecartees_du_client(uuid) from public, anon;')
    expect(migration).toContain('grant execute on function public.pieces_jointes_ecartees_du_client(uuid) to authenticated;')
    // La table reste fermée au client : la migration ne pose aucune policy.
    expect(migration).not.toMatch(/create policy/i)
  })
})
