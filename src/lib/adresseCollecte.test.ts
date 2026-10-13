import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ADRESSE_COPIEE, ADRESSE_ILLISIBLE, adresseDeCollecte, ceQueAccepteLAdresse, COPIE_REFUSEE, COPIER_L_ADRESSE,
  DOMAINE_COLLECTE_EMAIL, ENVOI_PAR_EMAIL, lectureDeLAdresseDeCollecte, lireLAdresseDeCollecte,
} from './adresseCollecte'
import { poids, refusDUnePiece, TAILLE_MAX_PIECE, typeDUnePiece } from './bornesStockage'
import type { ReponseDeLaBase } from './couvertureReleve'
import { motsDuCabinet } from './espaceVentes'

// L'ADRESSE DE COLLECTE PAR E-MAIL D'UN DOSSIER (ligne 22.93). Ce qui se garde ici : la composition ne s'écrit qu'à UN
// endroit de `src/` (le cabinet et le client la lisent du même module) ; la lecture du client ne rend jamais une adresse
// qu'elle n'a pas lue — une erreur, une ligne absente, une forme inconnue ou un code qu'aucun dossier n'a rendent RIEN,
// avec le motif ; ce que l'adresse accepte est tiré de `bornesStockage.ts` et confronté à son refus de format, pas recopié ;
// et les mots sont ceux du client. Données FICTIVES.

const reponse = (data: unknown, error: unknown = null): ReponseDeLaBase => ({ data, error })

// Une requête comme PostgREST en construit une : un `then` qui ne rend rien (le patron de couvertureReleve.test.ts).
function requete(rendre: () => ReponseDeLaBase): PromiseLike<ReponseDeLaBase> {
  const objet = {
    then(suite: (r: ReponseDeLaBase) => unknown, echec?: (e: unknown) => unknown) {
      Promise.resolve().then(rendre).then(suite, echec)
      return undefined
    },
  }
  return objet as unknown as PromiseLike<ReponseDeLaBase>
}

describe('la composition : <code du dossier>@<domaine>, une seule fois', () => {
  it('compose l’adresse d’un code, et rien d’un code absent ou vide', () => {
    expect(DOMAINE_COLLECTE_EMAIL).toBe('precompta.jdarnis.fr')
    expect(adresseDeCollecte('abc123')).toBe('abc123@precompta.jdarnis.fr')
    expect(adresseDeCollecte('cabinet-infirmier-001c7e')).toBe('cabinet-infirmier-001c7e@precompta.jdarnis.fr')
    for (const vide of [null, undefined, '']) expect(adresseDeCollecte(vide)).toBeNull()
  })

  it('le domaine ne s’écrit qu’à un seul endroit du code de l’application (les tests et les Edge Functions mis à part)', () => {
    const racine = new URL('./../', import.meta.url)
    const ecrivent: string[] = []
    let lus = 0
    const parcourir = (dossier: URL, prefixe: string) => {
      for (const entree of readdirSync(dossier, { withFileTypes: true })) {
        if (entree.name === 'test') continue
        const suivant = new URL(`${entree.name}${entree.isDirectory() ? '/' : ''}`, dossier)
        if (entree.isDirectory()) { parcourir(suivant, `${prefixe}${entree.name}/`); continue }
        if (!/\.tsx?$/.test(entree.name) || /\.test\.tsx?$/.test(entree.name)) continue
        lus++
        if (readFileSync(suivant, 'utf8').includes('precompta.jdarnis.fr')) ecrivent.push(`${prefixe}${entree.name}`)
      }
    }
    parcourir(racine, '')
    // Un plancher : sans lui, « un seul endroit » passerait aussi pour un balayage qui ne lit rien.
    expect(lus).toBeGreaterThan(200)
    expect(ecrivent).toEqual(['lib/adresseCollecte.ts'])
  })
})

describe('la lecture du client : l’adresse lue, ou rien et pourquoi — jamais une adresse devinée', () => {
  it('lit le code de la ligne du dossier et compose l’adresse', () => {
    expect(lectureDeLAdresseDeCollecte(reponse({ code_email: 'dossier-fictif-3f9a2c' })))
      .toEqual({ adresse: 'dossier-fictif-3f9a2c@precompta.jdarnis.fr', motif: null })
    // Un champ de plus, s'il en venait un, n'est jamais repris.
    expect(lectureDeLAdresseDeCollecte(reponse({ code_email: 'abc', nom: 'Dossier fictif' })).adresse).toBe('abc@precompta.jdarnis.fr')
    // `generate_code_email` peut commencer par un tiret, quand le nom du dossier commence par un signe.
    expect(lectureDeLAdresseDeCollecte(reponse({ code_email: '-test-abc123' })).adresse).toBe('-test-abc123@precompta.jdarnis.fr')
  })

  it('un dossier sans code : rien, SANS motif — il n’y a rien à dire ni à signaler', () => {
    expect(lectureDeLAdresseDeCollecte(reponse({ code_email: null }))).toEqual({ adresse: null, motif: null })
    expect(lectureDeLAdresseDeCollecte(reponse({ code_email: '' }))).toEqual({ adresse: null, motif: null })
  })

  it('un refus de la base : rien, avec son motif', () => {
    expect(lectureDeLAdresseDeCollecte(reponse(null, { message: 'permission denied for table dossiers' })))
      .toEqual({ adresse: null, motif: 'lecture refusée : permission denied for table dossiers' })
    // Une erreur sans message lisible : le repli, jamais l'objet.
    expect(lectureDeLAdresseDeCollecte(reponse(null, {})).motif).toBe('lecture refusée : raison inconnue')
    // L'erreur l'emporte sur des données que la réponse porterait encore.
    expect(lectureDeLAdresseDeCollecte(reponse({ code_email: 'abc' }, { message: 'refusé' })).adresse).toBeNull()
  })

  it('une ligne absente (la RLS ne rend rien sans le dire) : rien, avec son motif', () => {
    expect(lectureDeLAdresseDeCollecte(reponse(null))).toEqual({ adresse: null, motif: 'dossier introuvable' })
    expect(lectureDeLAdresseDeCollecte(reponse(undefined))).toEqual({ adresse: null, motif: 'dossier introuvable' })
  })

  it('toute autre forme est illisible : jamais une adresse', () => {
    for (const rendu of ['abc', 3, true, [], [{ code_email: 'abc' }], {}, { code_email: 42 }, { code_email: ['abc'] }, { code_email: { a: 1 } }]) {
      expect(lectureDeLAdresseDeCollecte(reponse(rendu)), JSON.stringify(rendu)).toEqual({ adresse: null, motif: 'réponse illisible' })
    }
  })

  it('un code d’une forme qu’aucun dossier n’a ne passe pas pour une adresse : un blanc, un « @ », une barre, un accent', () => {
    for (const code of ['a b', ' abc', 'abc ', 'a@b', 'abc@precompta.jdarnis.fr', 'a/b', 'a\nb', 'été', 'a,b', '<abc>']) {
      expect(lectureDeLAdresseDeCollecte(reponse({ code_email: code })), JSON.stringify(code)).toEqual({ adresse: null, motif: 'réponse illisible' })
    }
  })

  it('lireLAdresseDeCollecte attend la requête ; une requête qui lève tombe du côté signalé, avec son motif', async () => {
    expect(await lireLAdresseDeCollecte(requete(() => reponse({ code_email: 'abc' }))))
      .toEqual({ adresse: 'abc@precompta.jdarnis.fr', motif: null })
    expect(await lireLAdresseDeCollecte(requete(() => reponse(null, { message: 'permission denied' }))))
      .toEqual({ adresse: null, motif: 'lecture refusée : permission denied' })
    expect(await lireLAdresseDeCollecte(requete(() => { throw new Error('réseau coupé') })))
      .toEqual({ adresse: null, motif: 'lecture impossible : réseau coupé' })
    // Une requête rejetée par un objet nu (pas une `Error`) se dit aussi.
    expect(await lireLAdresseDeCollecte(requete(() => { throw { message: 'délai dépassé' } })))
      .toEqual({ adresse: null, motif: 'lecture impossible : délai dépassé' })
  })
})

describe('ce que l’adresse accepte : tiré de la borne d’une pièce, confronté à son refus de format', () => {
  it('dit les formats et le poids d’une pièce, sans les recopier', async () => {
    const phrase = ceQueAccepteLAdresse()
    expect(phrase).toBe(`Elle accepte les pièces jointes en PDF, JPEG, PNG ou CSV, de ${poids(TAILLE_MAX_PIECE)} au plus chacune.`)
    // (« 20 Mo » tient son unité par une espace insécable : `\s` la prend.)
    expect(phrase).toMatch(/de 20\sMo au plus/)
    // Le refus d'un format, tel que le client le lit au dépôt, nomme les mêmes formats : une référence extérieure à la phrase.
    const refus = await refusDUnePiece(new File(['x'], 'image.gif'))
    expect(refus?.message).toContain('PDF, JPEG, PNG ou CSV')
    expect(phrase).toContain('PDF, JPEG, PNG ou CSV')
  })

  it('chaque format dit est un format que le dépôt accepte, et un autre ne l’est pas', () => {
    const debut = new Uint8Array([0, 0, 0, 0])
    for (const extension of ['pdf', 'jpeg', 'png', 'csv']) expect(typeDUnePiece(`piece.${extension}`, debut), extension).not.toBeNull()
    for (const extension of ['gif', 'docx', 'zip', 'svg']) expect(typeDUnePiece(`piece.${extension}`, debut), extension).toBeNull()
  })
})

describe('les mots du client : tutoiement, aucun onglet, jamais « le client » pour le titulaire', () => {
  it('aucun mot du cabinet', () => {
    const textes = [ENVOI_PAR_EMAIL, COPIER_L_ADRESSE, ADRESSE_COPIEE, COPIE_REFUSEE, ADRESSE_ILLISIBLE, ceQueAccepteLAdresse(),
      `${ENVOI_PAR_EMAIL} ${adresseDeCollecte('abc123')}`]
    for (const texte of textes) {
      expect(motsDuCabinet(texte), texte).toEqual([])
      expect(texte, texte).not.toMatch(/\bclients?\b/i)
    }
    // Le garde voit bien ce qu'il garde.
    expect(motsDuCabinet('Le client transfère ses e-mails : voir l’onglet Accès.').length).toBeGreaterThan(0)
  })
})
