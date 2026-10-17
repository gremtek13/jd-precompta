import { beforeAll, describe, expect, it } from 'vitest'
import { TAILLE_MAX } from './bornesStockage'
import { cheminDuLogo } from './logoDesFactures'
import {
  EXPLICATION_DEJA_LA, EXPLICATION_REDEPOSE, VERSION_SAUVEGARDE, bilanDesLogos, depuisBase64, ecartsDesLogos, enBase64,
  explicationDuDepotEchoue, explicationDuManque, incoherencesDesLogos, logoInclus, logoSauvegarde, logosDesVersions, phraseDesLogosManquants,
  phrasesDuBilanDesLogos, planDesLogos, resumeDesLogos, type FichierDeSauvegarde, type LogoManquant, type LogoRestaure,
} from './sauvegardeLogos'
import { empreinteDe, jpegFictif, logoDe } from '../test/logoFictif'

// LE LOGO DES FACTURES DANS LA SAUVEGARDE (étape A5c2b) : le module pur. Ce que le fichier porte, ce que le manifeste en dit,
// ce que la lecture d'un fichier refuse, ce que la restauration redéposera — et ce qu'elle dit de chaque logo qui ne revient
// pas. Données fictives : des PNG de 1 × 1 pixel et un JPEG écrits dans le code (src/test/logoFictif.ts).

const D = 'a5c00000-0000-4000-8000-0000000000d1'
const AUTRE = 'a5c00000-0000-4000-8000-0000000000d2'
let OCTETS_A: Uint8Array<ArrayBuffer>
let OCTETS_B: Uint8Array<ArrayBuffer>
let HA: string
let HB: string
let HJ: string
let CHEMIN_A: string
let CHEMIN_B: string
let CHEMIN_J: string

beforeAll(async () => {
  OCTETS_A = logoDe(1)
  OCTETS_B = logoDe(2)
  HA = await empreinteDe(OCTETS_A)
  HB = await empreinteDe(OCTETS_B)
  HJ = await empreinteDe(jpegFictif())
  CHEMIN_A = cheminDuLogo(D, HA, 'image/png')
  CHEMIN_B = cheminDuLogo(D, HB, 'image/png')
  CHEMIN_J = cheminDuLogo(D, HJ, 'image/jpeg')
})

type Ligne = Record<string, unknown>
const version = (id: string, chemin: string | null, empreinte: string | null, o: Ligne = {}): Ligne => ({
  id, dossier_id: D, logo_chemin: chemin, logo_sha256: empreinte, ...o,
})
const fichier = (chemin: string, empreinte: string, octets: Uint8Array, o: Partial<FichierDeSauvegarde> = {}): FichierDeSauvegarde => ({
  seau: 'ventes', chemin, empreinte, type: chemin.endsWith('.jpg') ? 'image/jpeg' : 'image/png', octets: octets.length, base64: enBase64(octets), ...o,
})
const contenuAvec = (...versions: Ligne[]) => ({ dossiers: [{ id: D }], parametres_facturation: versions })

describe('le format', () => {
  it('est le deuxième : les lignes, et les fichiers des logos', () => {
    expect(VERSION_SAUVEGARDE).toBe(2)
  })
})

describe('le base64', () => {
  // Une référence extérieure au module : le codage de Node, sur des octets écrits ici (jamais tirés au hasard).
  const octets = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) % 256)

  it('chaque valeur d’octet, et le remplissage, comme Node', () => {
    for (const n of [0, 1, 2, 3, 4, 255, 256]) {
      const o = octets(n)
      expect(enBase64(o)).toBe(Buffer.from(o).toString('base64'))
      expect(Array.from(depuisBase64(enBase64(o)) ?? [])).toEqual(Array.from(o))
    }
    const toutes = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(enBase64(toutes)).toBe(Buffer.from(toutes).toString('base64'))
  })

  it('un logo à la borne du seau, en plusieurs tranches, sans rien perdre', () => {
    const o = octets(TAILLE_MAX.ventes)
    const texte = enBase64(o)
    expect(texte).toBe(Buffer.from(o).toString('base64'))
    expect(Buffer.from(depuisBase64(texte) ?? new Uint8Array()).equals(Buffer.from(o))).toBe(true)
  })

  it('un texte qui n’est pas du base64 ne rend rien', () => {
    expect(depuisBase64('@@@@')).toBeNull()
    expect(depuisBase64('QUJDR')).toBeNull()
    expect(depuisBase64('')?.length).toBe(0)
  })
})

describe('les logos que les versions désignent', () => {
  it('chacun une fois, rangés par chemin, la courante comme les remplacées ; ni une version sans logo, ni des colonnes absentes', () => {
    const sansColonnes: Ligne = { id: 'v0', dossier_id: D }
    const designes = logosDesVersions(contenuAvec(
      version('v1', null, null), version('v2', CHEMIN_B, HB), version('v3', CHEMIN_A, HA), version('v4', CHEMIN_B, HB), sansColonnes,
    ))
    const attendus = [
      { chemin: CHEMIN_A, empreinte: HA, type: 'image/png', dossierId: D },
      { chemin: CHEMIN_B, empreinte: HB, type: 'image/png', dossierId: D },
    ].sort((a, b) => (a.chemin < b.chemin ? -1 : 1))
    expect(designes).toEqual(attendus)
  })

  it('le type que dit le nom, et aucun logo sans table des paramètres', () => {
    expect(logosDesVersions(contenuAvec(version('v1', CHEMIN_J, HJ)))[0].type).toBe('image/jpeg')
    expect(logosDesVersions({ dossiers: [{ id: D }] })).toEqual([])
  })

  it('un fichier relu forgé — une table qui n’est pas une liste, une ligne qui n’est pas un objet — ne désigne rien, sans lever', () => {
    expect(logosDesVersions({ parametres_facturation: { v1: version('v1', CHEMIN_A, HA) } } as never)).toEqual([])
    expect(logosDesVersions({ parametres_facturation: [null, 'v1', version('v2', CHEMIN_A, HA)] } as never).map((l) => l.chemin)).toEqual([CHEMIN_A])
  })
})

describe('ce que la sauvegarde retient d’un logo relu', () => {
  it('le fichier vérifié : ses octets en base64, son type, son poids', async () => {
    const lu = await logoSauvegarde(
      { chemin: CHEMIN_A, empreinte: HA, type: 'image/png', dossierId: D },
      { etat: 'verifie', corps: new Blob([OCTETS_A], { type: 'image/png' }), type: 'image/png', taille: OCTETS_A.length },
    )
    expect(lu).toEqual({ fichier: { seau: 'ventes', chemin: CHEMIN_A, empreinte: HA, type: 'image/png', octets: OCTETS_A.length, base64: enBase64(OCTETS_A) } })
    if (!('fichier' in lu)) throw new Error('attendu : un fichier')
    expect(logoInclus(lu.fichier)).toEqual({ chemin: CHEMIN_A, empreinte: HA, type: 'image/png', octets: OCTETS_A.length })
  })

  it.each([
    [{ etat: 'absent' as const }, /ne rend pas ce fichier/],
    [{ etat: 'refuse' as const, motif: 'erreur 500' }, /n’a pas rendu ce fichier \(erreur 500\)/],
    [{ etat: 'illisible' as const }, /n’est pas une image PNG ou JPEG/],
    [{ etat: 'autre_empreinte' as const }, /son empreinte diffère/],
  ])('un manque (%o) : nommé, avec sa raison et sa phrase — jamais tu', async (lu, phrase) => {
    const issue = await logoSauvegarde({ chemin: CHEMIN_A, empreinte: HA, type: 'image/png', dossierId: D }, lu)
    expect(issue).toEqual({ manquant: { chemin: CHEMIN_A, empreinte: HA, raison: lu.etat, explication: explicationDuManque(lu) } })
    expect(explicationDuManque(lu)).toMatch(phrase)
    expect(explicationDuManque(lu)).toMatch(/il n’est pas dans cette sauvegarde/)
  })
})

describe('la cohérence des logos d’une sauvegarde relue', () => {
  const coherente = () => ({
    logos: { inclus: [logoInclus(fichier(CHEMIN_A, HA, OCTETS_A))], manquants: [] as LogoManquant[] },
    fichiers: [fichier(CHEMIN_A, HA, OCTETS_A)] as unknown[],
    contenu: contenuAvec(version('v1', CHEMIN_A, HA)),
  })
  const juger = (s: ReturnType<typeof coherente>, v = 2) => incoherencesDesLogos(v, s.logos, s.fichiers, s.contenu)

  it('une sauvegarde qui se tient : rien à redire', () => {
    expect(juger(coherente())).toEqual([])
    // Un logo désigné qu'elle ne porte pas, dit manquant, se tient aussi.
    const s = coherente()
    s.contenu = contenuAvec(version('v1', CHEMIN_A, HA), version('v2', CHEMIN_B, HB, { remplace_id: 'v1' }))
    s.logos.manquants = [{ chemin: CHEMIN_B, empreinte: HB, raison: 'absent', explication: explicationDuManque({ etat: 'absent' }) }]
    expect(juger(s)).toEqual([])
  })

  it('le format 1 ne porte aucun fichier', () => {
    expect(incoherencesDesLogos(1, undefined, undefined, contenuAvec(version('v1', CHEMIN_A, HA)))).toEqual([])
    expect(incoherencesDesLogos(1, undefined, [], contenuAvec())).toEqual([])
    expect(incoherencesDesLogos(1, undefined, [fichier(CHEMIN_A, HA, OCTETS_A)], contenuAvec(version('v1', CHEMIN_A, HA))))
      .toEqual(['logos : une sauvegarde au format 1 ne porte aucun fichier, et ceux-ci ne seraient redéposés nulle part'])
  })

  it('un format 2 sans ce qu’il doit dire des logos', () => {
    const s = coherente()
    expect(incoherencesDesLogos(2, undefined, s.fichiers, s.contenu)).toEqual([
      'logos : le manifeste ne dit pas les logos des factures (« logos.inclus », « logos.manquants »)',
    ])
    expect(incoherencesDesLogos(2, { inclus: [] }, s.fichiers, s.contenu)).toHaveLength(1)
    expect(incoherencesDesLogos(2, s.logos, undefined, s.contenu)).toEqual(['logos : les fichiers des logos (« fichiers ») ne sont pas une liste'])
  })

  it.each([
    ['du seau des pièces', { seau: 'pieces' }, 'n’est pas du seau « ventes »'],
    ['une empreinte en majuscules', { empreinte: 'A'.repeat(64) }, 'n’a pas une empreinte SHA-256'],
    ['un chemin hors des logos', { chemin: `${D}/autre/x.png` }, 'n’a pas le chemin d’un logo'],
    ['un nom qui n’est pas son empreinte', { empreinte: 'b'.repeat(64) }, 'n’est pas nommé par son empreinte'],
    ['un type qui n’est pas celui de son nom', { type: 'image/jpeg' }, 'n’a pas le type que dit son nom'],
    ['un type d’un autre seau', { type: 'image/webp' }, 'n’a pas le type que dit son nom'],
    ['un poids nul', { octets: 0 }, 'n’a pas un poids d’un à 512000 octets'],
    ['un poids au-delà de la borne', { octets: TAILLE_MAX.ventes + 1 }, 'n’a pas un poids d’un à 512000 octets'],
    ['des octets qui ne sont pas un texte', { base64: 12 }, 'n’a pas ses octets en base64'],
  ])('un fichier d’une autre forme : %s', (_quoi, change, faute) => {
    const s = coherente()
    s.fichiers = [{ ...fichier(CHEMIN_A, HA, OCTETS_A), ...change }]
    const fautes = juger(s)
    expect(fautes).toHaveLength(1)
    expect(fautes[0]).toContain(faute)
    expect(fautes[0]).toMatch(/^logos : le fichier (« .+ »|n° 1) /)
  })

  it('un fichier qui n’est pas un objet, et des entrées du manifeste illisibles', () => {
    const s = coherente()
    s.fichiers = ['texte']
    expect(juger(s)).toEqual(['logos : le fichier n° 1 n’est pas un objet'])
    const t = coherente()
    t.logos = { inclus: [{ chemin: 3 }] as never, manquants: [{ chemin: CHEMIN_A, empreinte: HA, raison: 'perdu', explication: 'x' }] as never }
    expect(juger(t)).toEqual([
      'logos : une entrée de « logos.inclus » n’a pas de chemin ni d’empreinte lisibles',
      'logos : une entrée de « logos.manquants » n’a pas une raison connue',
    ])
  })

  it('porté sans être annoncé, annoncé autrement, annoncé et absent', () => {
    const sansAnnonce = coherente()
    sansAnnonce.logos.inclus = []
    expect(juger(sansAnnonce)).toEqual([`logos : le fichier « ${CHEMIN_A} » est porté sans être annoncé au manifeste`])

    const autrement = coherente()
    autrement.logos.inclus = [{ ...autrement.logos.inclus[0], octets: OCTETS_A.length + 1 }]
    expect(juger(autrement)).toEqual([`logos : le fichier « ${CHEMIN_A} » n’est pas porté tel que le manifeste l’annonce`])

    const absent = coherente()
    absent.fichiers = []
    expect(juger(absent)).toEqual([
      `logos : le fichier « ${CHEMIN_A} » est annoncé au manifeste et n’est pas porté`,
      `logos : le logo « ${CHEMIN_A} », qu’une version désigne, n’est ni porté ni dit manquant`,
    ])
  })

  it('porté deux fois ; porté et dit manquant', () => {
    const deux = coherente()
    deux.fichiers = [fichier(CHEMIN_A, HA, OCTETS_A), fichier(CHEMIN_A, HA, OCTETS_A)]
    expect(juger(deux)).toEqual([`logos : le fichier « ${CHEMIN_A} » est porté deux fois`])

    const lesDeux = coherente()
    lesDeux.logos.manquants = [{ chemin: CHEMIN_A, empreinte: HA, raison: 'absent', explication: 'x' }]
    expect(juger(lesDeux)).toEqual([`logos : le fichier « ${CHEMIN_A} » est porté et dit manquant`])
  })

  it('un intrus : un fichier qu’aucune version ne désigne, un manque qu’aucune version ne désigne', () => {
    const intrus = coherente()
    intrus.contenu = contenuAvec(version('v1', null, null))
    expect(juger(intrus)).toEqual([`logos : le fichier « ${CHEMIN_A} » n’est désigné par aucune version des paramètres de facturation`])

    const manque = coherente()
    manque.logos.manquants = [{ chemin: CHEMIN_B, empreinte: HB, raison: 'refuse', explication: 'x' }]
    expect(juger(manque)).toEqual([`logos : le logo manquant « ${CHEMIN_B} » n’est désigné par aucune version`])
  })

  it('un logo désigné ni porté ni dit manquant : la sauvegarde le tairait', () => {
    const s = coherente()
    s.contenu = contenuAvec(version('v1', CHEMIN_A, HA), version('v2', CHEMIN_B, HB, { remplace_id: 'v1' }))
    expect(juger(s)).toEqual([`logos : le logo « ${CHEMIN_B} », qu’une version désigne, n’est ni porté ni dit manquant`])
  })
})

describe('ce que la restauration redéposera, jugé avant d’écrire', () => {
  const sauvegarde = (o: { version?: number; fichiers?: FichierDeSauvegarde[]; versions?: Ligne[]; manquants?: LogoManquant[] } = {}) => ({
    manifeste: {
      version: o.version ?? 2, dossierId: D,
      ...(o.version === 1 ? {} : { logos: { inclus: (o.fichiers ?? []).map(logoInclus), manquants: o.manquants ?? [] } }),
    },
    contenu: contenuAvec(...(o.versions ?? [version('v1', CHEMIN_A, HA)])),
    ...(o.fichiers ? { fichiers: o.fichiers } : {}),
  })

  it('un fichier désigné, intact : à redéposer, sous le dossier de sa version, ses octets tels quels', async () => {
    const plan = await planDesLogos(sauvegarde({ fichiers: [fichier(CHEMIN_A, HA, OCTETS_A)] }))
    expect(plan.nonRedeposes).toEqual([])
    expect(plan.aRedeposer.map(({ corps: _corps, ...r }) => r)).toEqual([{ chemin: CHEMIN_A, empreinte: HA, dossierId: D }])
    expect(new Uint8Array(await plan.aRedeposer[0].corps.arrayBuffer())).toEqual(OCTETS_A)
  })

  it('un JPEG désigné sous son nom : à redéposer', async () => {
    const plan = await planDesLogos(sauvegarde({ versions: [version('v1', CHEMIN_J, HJ)], fichiers: [fichier(CHEMIN_J, HJ, jpegFictif())] }))
    expect(plan.aRedeposer.map((r) => r.chemin)).toEqual([CHEMIN_J])
  })

  const nonRedepose = async (s: ReturnType<typeof sauvegarde>, phrase: RegExp) => {
    const plan = await planDesLogos(s)
    expect(plan.aRedeposer).toEqual([])
    expect(plan.nonRedeposes).toHaveLength(1)
    expect(plan.nonRedeposes[0]).toMatchObject({ issue: 'non_redepose' })
    expect(plan.nonRedeposes[0].explication).toMatch(phrase)
    expect(plan.nonRedeposes[0].explication).toMatch(/il n’est pas redéposé\.$/)
  }

  it('un fichier qu’aucune version ne désigne : pas redéposé', async () => {
    await nonRedepose(sauvegarde({ versions: [version('v1', null, null)], fichiers: [fichier(CHEMIN_A, HA, OCTETS_A)] }), /Aucune version/)
  })

  it('désigné par une version d’un AUTRE dossier : pas redéposé — le super-administrateur pourrait déposer partout', async () => {
    const chemin = cheminDuLogo(AUTRE, HA, 'image/png')
    await nonRedepose(sauvegarde({ versions: [version('v1', chemin, HA, { dossier_id: AUTRE })], fichiers: [fichier(chemin, HA, OCTETS_A)] }),
      /n’est pas une version du dossier restauré/)
  })

  it('des octets qui ne se décodent pas : pas redéposé', async () => {
    await nonRedepose(sauvegarde({ fichiers: [fichier(CHEMIN_A, HA, OCTETS_A, { base64: '@@@@' })] }), /ne se décodent pas/)
  })

  it('des octets qui ne sont pas une image : pas redéposé, avec le refus du seau', async () => {
    const texte = new TextEncoder().encode('<svg/>')
    await nonRedepose(sauvegarde({ fichiers: [fichier(CHEMIN_A, HA, OCTETS_A, { base64: enBase64(texte) })] }),
      /Ce n’est pas un logo que le seau admet \(format non pris en charge/)
  })

  it('des octets d’une autre empreinte (le fichier de sauvegarde abîmé) : pas redéposé', async () => {
    await nonRedepose(sauvegarde({ fichiers: [fichier(CHEMIN_A, HA, OCTETS_A, { base64: enBase64(OCTETS_B) })] }),
      /n’ont pas l’empreinte que la version désigne/)
  })

  it('des octets JPEG sous un nom en « .png » : pas redéposé — il se rangerait sous un autre nom', async () => {
    const chemin = cheminDuLogo(D, HJ, 'image/png')
    await nonRedepose(sauvegarde({ versions: [version('v1', chemin, HJ)], fichiers: [fichier(chemin, HJ, jpegFictif())] }),
      /ne sont pas du type que dit son nom/)
  })

  it('un logo désigné que la sauvegarde ne porte pas : dit avec la raison de la sauvegarde, et où le redéposer', async () => {
    const manque: LogoManquant = { chemin: CHEMIN_A, empreinte: HA, raison: 'absent', explication: explicationDuManque({ etat: 'absent' }) }
    const plan = await planDesLogos(sauvegarde({ fichiers: [], manquants: [manque] }))
    expect(plan.aRedeposer).toEqual([])
    expect(plan.nonRedeposes).toEqual([{
      chemin: CHEMIN_A, empreinte: HA, issue: 'absent_de_la_sauvegarde',
      explication: `${manque.explication} La version restaurée le désigne : il est à redéposer depuis la vue « Paramètres » de l’onglet Factures (« Redéposer le fichier »).`,
    }])
  })

  it('une sauvegarde au format 1 : aucun fichier, chaque logo désigné dit absent', async () => {
    const plan = await planDesLogos(sauvegarde({ version: 1 }))
    expect(plan.aRedeposer).toEqual([])
    expect(plan.nonRedeposes).toHaveLength(1)
    expect(plan.nonRedeposes[0]).toMatchObject({ chemin: CHEMIN_A, issue: 'absent_de_la_sauvegarde' })
    expect(plan.nonRedeposes[0].explication).toMatch(/^Une sauvegarde au format 1 ne porte aucun fichier\. La version restaurée le désigne/)
  })

  it('un format 2 qui ne dit pas pourquoi il ne porte pas un logo désigné : le bilan le dit quand même', async () => {
    const plan = await planDesLogos(sauvegarde({ fichiers: [] }))
    expect(plan.nonRedeposes[0].explication).toMatch(/^La sauvegarde ne porte pas ce fichier, et son manifeste ne dit pas pourquoi\./)
  })
})

describe('le bilan et la vérification', () => {
  it('le dépôt échoué : sa raison, puis où le redéposer', () => {
    expect(explicationDuDepotEchoue('permission refusée')).toBe(
      'Le dépôt a échoué : permission refusée. La version restaurée le désigne : il est à redéposer depuis la vue « Paramètres » de '
      + 'l’onglet Factures (« Redéposer le fichier »).',
    )
    expect(explicationDuDepotEchoue('Refusé.')).toMatch(/^Le dépôt a échoué : Refusé\. La version/)
  })

  it('rangé par chemin, chaque issue sous son libellé', () => {
    const logos: LogoRestaure[] = [
      { chemin: 'b', empreinte: 'h2', issue: 'deja_la', explication: EXPLICATION_DEJA_LA },
      { chemin: 'a', empreinte: 'h1', issue: 'redepose', explication: EXPLICATION_REDEPOSE },
      { chemin: 'd', empreinte: 'h4', issue: 'absent_de_la_sauvegarde', explication: 'Absent.' },
      { chemin: 'c', empreinte: 'h3', issue: 'non_redepose', explication: 'Non.' },
    ]
    expect(bilanDesLogos(logos).map((l) => l.chemin)).toEqual(['a', 'b', 'c', 'd'])
    expect(phrasesDuBilanDesLogos(logos)).toEqual([
      `Redéposé — a : ${EXPLICATION_REDEPOSE}`,
      `Déjà présent — b : ${EXPLICATION_DEJA_LA}`,
      'Non redéposé — c : Non.',
      'Absent de la sauvegarde — d : Absent.',
    ])
  })

  it('un fichier porté que la relecture ne retrouve pas, ou pas avec son empreinte : un écart ; ce qu’elle ne portait pas, aucun', () => {
    const a = fichier(CHEMIN_A, HA, OCTETS_A)
    const b = fichier(CHEMIN_B, HB, OCTETS_B)
    expect(ecartsDesLogos({ fichiers: [a, b] }, { fichiers: [a] })).toEqual([{ table: 'ventes', motif: 'fichier_absent', identite: CHEMIN_B }])
    expect(ecartsDesLogos({ fichiers: [a] }, { fichiers: [{ ...a, empreinte: HB }] })).toEqual([{ table: 'ventes', motif: 'fichier_absent', identite: CHEMIN_A }])
    expect(ecartsDesLogos({ fichiers: [a] }, {})).toHaveLength(1)
    expect(ecartsDesLogos({ fichiers: [a] }, { fichiers: [a, b] })).toEqual([])
    expect(ecartsDesLogos({}, { fichiers: [a] })).toEqual([])
  })
})

describe('ce que les écrans en disent', () => {
  const manque = (chemin: string, raison: LogoManquant['raison'] = 'absent'): LogoManquant => ({
    chemin, empreinte: 'h', raison, explication: `Explication de ${chemin}.`,
  })

  it('la carte de la sauvegarde : rien sans manque ; sinon combien, et pourquoi chacun', () => {
    expect(phraseDesLogosManquants(undefined)).toBeNull()
    expect(phraseDesLogosManquants({ inclus: [], manquants: [] })).toBeNull()
    expect(phraseDesLogosManquants({ inclus: [], manquants: [manque('x')] })).toBe(
      '1 logo des factures n’est pas dans cette sauvegarde, que les versions des paramètres désignent pourtant ; le reste du '
      + 'dossier y est. Explication de x.',
    )
    expect(phraseDesLogosManquants({ inclus: [], manquants: [manque('x'), manque('y')] }))
      .toMatch(/^2 logos des factures ne sont pas dans cette sauvegarde, .* Explication de x\. Explication de y\.$/)
  })

  it('la carte de la restauration, avant le clic', () => {
    const base = { contenu: contenuAvec(version('v1', CHEMIN_A, HA), version('v2', CHEMIN_B, HB)) }
    expect(resumeDesLogos({ manifeste: { version: 2, dossierId: D }, contenu: contenuAvec(version('v1', null, null)) })).toBeNull()
    expect(resumeDesLogos({ manifeste: { version: 1, dossierId: D }, ...base })).toBe(
      'Sauvegarde au format 1 : elle ne porte aucun fichier. Les versions des paramètres de facturation désignent 2 logos : ils '
      + 'seront à redéposer depuis la vue « Paramètres » de l’onglet Factures.',
    )
    expect(resumeDesLogos({ manifeste: { version: 2, dossierId: D }, ...base, fichiers: [fichier(CHEMIN_A, HA, OCTETS_A)] })).toBe(
      'Logos des factures : 1 fichier porté, redéposés dans le seau « ventes » après les lignes, leur empreinte vérifiée avant '
      + 'chaque dépôt ; 1 logo désigné que la sauvegarde ne porte pas.',
    )
    expect(resumeDesLogos({
      manifeste: { version: 2, dossierId: D }, ...base, fichiers: [fichier(CHEMIN_A, HA, OCTETS_A), fichier(CHEMIN_B, HB, OCTETS_B)],
    })).toMatch(/^Logos des factures : 2 fichiers portés, .* avant chaque dépôt\.$/)
  })
})
