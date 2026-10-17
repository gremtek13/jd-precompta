import { beforeAll, describe, expect, it } from 'vitest'
import { cheminDuLogo } from './logoDesFactures'
import {
  empreinte,
  lireSauvegarde,
  nomFichierSauvegarde,
  serialiserCanonique,
  serialiserSauvegarde,
} from './sauvegardeFichier'
import type { Manifeste, SauvegardeDossier } from './sauvegardeDonnees'
import { VERSION_SAUVEGARDE, enBase64, logoInclus, type FichierDeSauvegarde } from './sauvegardeLogos'
import { empreinteDe, logoDe } from '../test/logoFictif'

const manifeste = (o: Partial<Manifeste> = {}): Manifeste => ({
  version: 1,
  dossierId: 'd1',
  dossierNom: 'Cabinet Martin',
  cabinetId: 'cab1',
  faiteLe: '2026-09-18T21:30:00.000Z',
  lignesParTable: { dossiers: 1, pieces: 2 },
  comptes: { obligatoires: [], facultatifs: [] },
  referencesExternes: [],
  liensPerdus: [],
  horsPerimetre: [],
  ...o,
})

const sauvegarde = (): SauvegardeDossier => ({
  manifeste: manifeste(),
  contenu: {
    dossiers: [{ id: 'd1', nom: 'Cabinet Martin', cabinet_id: 'cab1' }],
    pieces: [
      { id: 'p1', dossier_id: 'd1', montant_ttc: 120.5, tiers: 'EDF' },
      { id: 'p2', dossier_id: 'd1', montant_ttc: null, tiers: 'Transmedical' },
    ],
  },
})

describe('forme canonique', () => {
  it('rend la même chaîne quel que soit l’ordre des clés', () => {
    // C'est ce qui permet à l'empreinte de mesurer le CONTENU. PostgREST ne garantit pas l'ordre des
    // colonnes qu'il rend, et une sauvegarde relue puis réécrite ne doit pas se déclarer corrompue.
    expect(serialiserCanonique({ b: 1, a: 2 })).toBe(serialiserCanonique({ a: 2, b: 1 }))
    expect(serialiserCanonique({ x: { d: 4, c: 3 } })).toBe(serialiserCanonique({ x: { c: 3, d: 4 } }))
  })

  it('distingue deux contenus réellement différents', () => {
    expect(serialiserCanonique({ a: 1 })).not.toBe(serialiserCanonique({ a: 2 }))
    // Le piège classique d'une concaténation naïve : deux structures différentes qui donneraient la
    // même suite de caractères.
    expect(serialiserCanonique({ a: '1,b:2' })).not.toBe(serialiserCanonique({ a: 1, b: 2 }))
  })

  it('ne confond pas deux structures à cause d’un nom de colonne biscornu', () => {
    // La forme canonique doit être injective : deux contenus différents ne doivent JAMAIS rendre la
    // même chaîne, sinon l'empreinte laisserait passer une corruption. D'où les noms de clés entre
    // guillemets — sans eux, une clé contenant « : » ou « , » imiterait deux clés.
    expect(serialiserCanonique({ 'a:1,b': 2 })).not.toBe(serialiserCanonique({ a: 1, b: 2 }))
  })

  it('rend « null » plutôt que rien pour une valeur sans représentation JSON', () => {
    // `JSON.stringify` rend `undefined` — pas la chaîne, la valeur — pour ce qu'il ne sait pas
    // représenter. Le laisser passer effacerait la valeur de la chaîne canonique, et deux contenus
    // différents partageraient alors une empreinte.
    expect(serialiserCanonique(undefined)).toBe('null')
    expect(serialiserCanonique([undefined, 1])).toBe('[null,1]')
  })

  it('garde l’ordre d’un tableau, qui lui porte du sens', () => {
    expect(serialiserCanonique([1, 2])).not.toBe(serialiserCanonique([2, 1]))
  })

  it('distingue un champ vide d’un champ absent', () => {
    // Un montant nul et un montant non renseigné ne sont pas la même chose en comptabilité.
    expect(serialiserCanonique({ a: null })).not.toBe(serialiserCanonique({}))
    expect(serialiserCanonique({ a: undefined })).toBe(serialiserCanonique({}))
  })
})

describe('écriture et relecture d’une sauvegarde', () => {
  it('rend exactement ce qu’on lui a donné', async () => {
    const original = sauvegarde()
    expect(await lireSauvegarde(await serialiserSauvegarde(original))).toEqual(original)
  })

  it('reste lisible après avoir été remise en forme', async () => {
    // Quelqu'un ouvre la sauvegarde dans un éditeur pour vérifier qu'il tient le bon dossier, et
    // l'enregistre. Si ce geste suffisait à la déclarer corrompue, le contrôle serait désactivé — et
    // c'est alors la vraie corruption qu'on ne verrait plus.
    const texte = await serialiserSauvegarde(sauvegarde())
    const remisEnForme = JSON.stringify(JSON.parse(texte))
    expect((await lireSauvegarde(remisEnForme)).contenu.pieces).toHaveLength(2)
  })

  it('refuse un montant modifié dans le fichier', async () => {
    // Le cas qui justifie l'empreinte : une fois le fichier sorti de la plateforme, plus rien ne
    // garantit qu'il revienne intact. Un chiffre changé ne se voit pas à l'œil.
    const texte = await serialiserSauvegarde(sauvegarde())
    await expect(lireSauvegarde(texte.replace('120.5', '1205'))).rejects.toThrow(/Sauvegarde corrompue/)
  })

  it('refuse un fichier tronqué', async () => {
    // Un téléchargement interrompu, une clé USB retirée trop tôt. Le JSON devient illisible — et
    // c'est une chance : tronqué juste après une accolade, il resterait valide et amputé.
    const texte = await serialiserSauvegarde(sauvegarde())
    await expect(lireSauvegarde(texte.slice(0, texte.length - 40))).rejects.toThrow(/illisible ou tronqué/)
  })

  it('refuse un fichier qui n’est pas une sauvegarde', async () => {
    await expect(lireSauvegarde('{"autre": 1}')).rejects.toThrow(/manifeste ou son contenu/)
    await expect(lireSauvegarde('[]')).rejects.toThrow(/manifeste ou son contenu/)
  })

  it('refuse une sauvegarde dont le manifeste ment sur ce qu’elle contient', async () => {
    // L'empreinte dit que le contenu est celui qu'on a écrit ; le manifeste dit ce qu'on CROYAIT
    // écrire. Une version fautive de l'export les ferait diverger — avec une empreinte parfaite.
    const fautive = sauvegarde()
    fautive.manifeste = manifeste({ lignesParTable: { dossiers: 1, pieces: 9 } })
    await expect(lireSauvegarde(await serialiserSauvegarde(fautive)))
      .rejects.toThrow(/pieces : 9 annoncées, 2 présentes/)
  })

  it('refuse une table présente dans le contenu mais absente du manifeste', async () => {
    // L'autre sens du même contrôle : une table qu'on restaurerait sans l'avoir annoncée.
    const fautive = sauvegarde()
    fautive.manifeste = manifeste({ lignesParTable: { dossiers: 1 } })
    await expect(lireSauvegarde(await serialiserSauvegarde(fautive)))
      .rejects.toThrow(/pieces : présente dans le contenu, absente du manifeste/)
  })

  it('accepte une table annoncée vide et effectivement vide', async () => {
    const vide = sauvegarde()
    vide.contenu.categories = []
    vide.manifeste = manifeste({ lignesParTable: { dossiers: 1, pieces: 2, categories: 0 } })
    expect((await lireSauvegarde(await serialiserSauvegarde(vide))).contenu.categories).toEqual([])
  })
})

// LE FORMAT 2 (étape A5c2b) : les fichiers des logos des factures, en base64, à la fin du même JSON ; le manifeste les annonce.
// Le format se juge AVANT l'empreinte ; les logos se jugent à leur cohérence (src/lib/sauvegardeLogos.ts), leurs octets à la
// restauration.
describe('le format 2 : les logos des factures dans le fichier', () => {
  const D = 'a5c00000-0000-4000-8000-0000000000d1'
  let OCTETS: Uint8Array<ArrayBuffer>
  let FICHIER: FichierDeSauvegarde

  beforeAll(async () => {
    OCTETS = logoDe(4)
    const h = await empreinteDe(OCTETS)
    FICHIER = { seau: 'ventes', chemin: cheminDuLogo(D, h, 'image/png'), empreinte: h, type: 'image/png', octets: OCTETS.length, base64: enBase64(OCTETS) }
  })

  const deuxieme = (): SauvegardeDossier => ({
    manifeste: manifeste({
      version: 2, dossierId: D, lignesParTable: { dossiers: 1, parametres_facturation: 1 },
      logos: { inclus: [logoInclus(FICHIER)], manquants: [] },
    }),
    contenu: {
      dossiers: [{ id: D, nom: 'Atelier fictif', cabinet_id: 'cab1' }],
      parametres_facturation: [{ id: 'v1', dossier_id: D, logo_chemin: FICHIER.chemin, logo_sha256: FICHIER.empreinte }],
    },
    fichiers: [FICHIER],
  })

  it('rend exactement ce qu’on lui a donné, fichiers compris, et les écrit après les lignes', async () => {
    expect(VERSION_SAUVEGARDE).toBe(2)
    const original = deuxieme()
    const texte = await serialiserSauvegarde(original)
    expect(await lireSauvegarde(texte)).toEqual(original)
    expect(Object.keys(JSON.parse(texte))).toEqual(['manifeste', 'empreinte', 'contenu', 'fichiers'])
  })

  it('l’empreinte ne couvre que les lignes : remis en forme, le fichier reste lisible ; un format 1 s’écrit sans « fichiers »', async () => {
    const texte = await serialiserSauvegarde(deuxieme())
    expect((await lireSauvegarde(JSON.stringify(JSON.parse(texte)))).fichiers).toEqual([FICHIER])
    expect(Object.keys(JSON.parse(await serialiserSauvegarde(sauvegarde())))).toEqual(['manifeste', 'empreinte', 'contenu'])
    expect('fichiers' in await lireSauvegarde(await serialiserSauvegarde(sauvegarde()))).toBe(false)
  })

  it('un format plus récent que le code est refusé à la lecture, AVANT l’empreinte, en le disant', async () => {
    const recente = deuxieme()
    recente.manifeste = { ...recente.manifeste, version: VERSION_SAUVEGARDE + 1 }
    // Une empreinte qu'un format futur écrirait autrement : le refus dit le format, jamais « corrompue ».
    const texte = (await serialiserSauvegarde(recente)).replace(/"empreinte": "[0-9a-f]{64}"/, '"empreinte": "autre"')
    await expect(lireSauvegarde(texte)).rejects.toThrow(`Cette sauvegarde est au format 3, ce code n'en connaît que 2`)
  })

  it.each([
    ['absent', undefined],
    ['un texte', '2'],
    ['zéro', 0],
    ['un nombre à virgule', 1.5],
  ])('un format %s : le fichier n’est pas une sauvegarde lisible', async (_quoi, version) => {
    const texte = JSON.parse(await serialiserSauvegarde(sauvegarde())) as { manifeste: Record<string, unknown> }
    texte.manifeste.version = version
    await expect(lireSauvegarde(JSON.stringify(texte))).rejects.toThrow(/son format \(« version »\) manque ou n'est pas un entier/)
  })

  it('un fichier porté que le manifeste n’annonce pas : refusé comme une table qu’il n’annonce pas', async () => {
    const fautive = deuxieme()
    fautive.manifeste = { ...fautive.manifeste, logos: { inclus: [], manquants: [] } }
    await expect(lireSauvegarde(await serialiserSauvegarde(fautive)))
      .rejects.toThrow(`Sauvegarde incohérente avec son manifeste :\n- logos : le fichier « ${FICHIER.chemin} » est porté sans être annoncé au manifeste`)
  })

  it('un logo désigné que la sauvegarde ne porte ni ne dit manquant : refusé — elle le tairait', async () => {
    const fautive = deuxieme()
    fautive.fichiers = []
    fautive.manifeste = { ...fautive.manifeste, logos: { inclus: [], manquants: [] } }
    await expect(lireSauvegarde(await serialiserSauvegarde(fautive))).rejects.toThrow(/n’est ni porté ni dit manquant/)
  })

  it('un format 2 sans ce qu’il dit des logos : refusé', async () => {
    const fautive = deuxieme()
    const { logos: _logos, ...sansLogos } = fautive.manifeste
    fautive.manifeste = sansLogos
    await expect(lireSauvegarde(await serialiserSauvegarde(fautive))).rejects.toThrow(/le manifeste ne dit pas les logos des factures/)
  })

  it('des octets abîmés ne font pas refuser le fichier : chaque logo se vérifie à la restauration, qui le dit', async () => {
    const abimee = deuxieme()
    abimee.fichiers = [{ ...FICHIER, base64: enBase64(logoDe(5)) }]
    expect((await lireSauvegarde(await serialiserSauvegarde(abimee))).fichiers).toEqual(abimee.fichiers)
  })

  it('un format 1 qui porterait des fichiers : refusé, ils ne seraient redéposés nulle part', async () => {
    const texte = JSON.parse(await serialiserSauvegarde(sauvegarde())) as Record<string, unknown>
    texte.fichiers = [FICHIER]
    await expect(lireSauvegarde(JSON.stringify(texte))).rejects.toThrow(/une sauvegarde au format 1 ne porte aucun fichier/)
  })
})

describe('nom du fichier', () => {
  it('porte le dossier et le jour', () => {
    // `slugify` retire les accents et la ponctuation mais garde la casse — même convention que les
    // sous-dossiers d'un export de cabinet, pour qu'un répertoire de sauvegardes se lise d'un coup.
    expect(nomFichierSauvegarde(manifeste())).toMatch(/^sauvegarde_Cabinet_Martin_\d{4}-\d{2}-\d{2}\.json$/)
  })

  it('retombe sur l’identifiant quand le nom ne donne rien', () => {
    // `slugify` réduit toute ponctuation : un nom qui n'est fait que de ça rendrait une chaîne vide,
    // et deux dossiers différents finiraient sous le même nom de fichier.
    expect(nomFichierSauvegarde(manifeste({ dossierNom: '???' }))).toContain('d1')
  })
})

describe('empreinte', () => {
  it('est un SHA-256 en hexadécimal', async () => {
    // Le condensé connu de la chaîne vide : de quoi vérifier l'algorithme et l'encodage d'un coup.
    expect(await empreinte('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
