import { describe, expect, it } from 'vitest'
import {
  empreinte,
  lireSauvegarde,
  nomFichierSauvegarde,
  serialiserCanonique,
  serialiserSauvegarde,
} from './sauvegardeFichier'
import type { Manifeste, SauvegardeDossier } from './sauvegardeDonnees'

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
