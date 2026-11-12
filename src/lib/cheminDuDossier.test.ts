import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cheminDuDossier } from './cheminDuDossier'

// La règle des écrans (cheminDuDossier) et celle de la base (la migration `chemin_dans_son_dossier`, CFCS-Q1) jugent le
// même chemin de la même façon : la batterie de l'essai `supabase/essais/cheminsDansLeurDossier.sql`, rejouée ici, et le
// texte de la migration, relu pour ses trois contraintes et leurs quatre règles.
const P = 'ac538d93-7da3-4403-bca6-2d7836810a6f'
const A = '001c7ed7-c23b-4590-901e-693489f8af24'
const BARRE_INVERSE = String.fromCharCode(92)

const FAUTIFS: readonly [string, string][] = [
  ['un autre dossier', `${A}/1731400000000-facture.pdf`],
  ['le dossier seul', P],
  ['une barre finale', `${P}/`],
  ['un segment vide', `${P}//x.pdf`],
  ['une barre en tête', `/${P}/x.pdf`],
  ['un segment « . »', `${P}/./x.pdf`],
  ['« .. » vers un autre dossier', `${P}/../${A}/x.pdf`],
  ['« .. » final', `${P}/x/..`],
  ['« . » final', `${P}/.`],
  ['la barre oblique inverse', `${P}/..${BARRE_INVERSE}${A}/x.pdf`],
  ['« %2e%2e »', `${P}/%2e%2e/${A}/x.pdf`],
  ['« .%2E »', `${P}/.%2E/${A}/x.pdf`],
  ['une tabulation', `${P}/.${String.fromCharCode(9)}./${A}/x.pdf`],
  ['un saut de ligne', `${P}/x${String.fromCharCode(10)}.pdf`],
  ['« ? »', `${P}/x.pdf?${A}`],
  ['« # »', `${P}/x.pdf#${A}`],
  ['le dossier en majuscules', `${P.toUpperCase()}/x.pdf`],
  ['un contrôle C1', `${P}/x${String.fromCharCode(0x85)}.pdf`],
]

const LEGITIMES: readonly string[] = [
  `${P}/1731400000000-facture.pdf`, `${P}/documents/1731400000000-regul.pdf`, `${P}/superpdp-123.txt`,
  `${P}/Facture (1).pdf`, `${P}/a...b.pdf`, `${P}/.cache.pdf`, `${P}/1731400000000-facture-lisible.pdf`,
]

describe('cheminDuDossier, la règle de la base (CFCS-Q1)', () => {
  it.each(FAUTIFS)('refuse %s', (_raison, chemin) => {
    expect(cheminDuDossier(chemin, P)).toBe(false)
  })

  it.each(LEGITIMES)('admet %s', (chemin) => {
    expect(cheminDuDossier(chemin, P)).toBe(true)
  })

  it('la batterie est celle de l’essai de la base, chemin pour chemin', () => {
    const essai = readFileSync(new URL('../../supabase/essais/cheminsDansLeurDossier.sql', import.meta.url), 'utf8')
    // Dix-sept chemins fautifs et six légitimes dans l'essai ; ici, un contrôle C1 de plus (la base le refuse par [:cntrl:]).
    expect((essai.match(/fautifs constant text\[\] := array\[([\s\S]*?)\];/)?.[1] ?? '').split(/,\s*(?=p \|\||a \|\||'\/'|upper|p,)/).length).toBe(17)
    expect(FAUTIFS.length).toBe(18)
    expect(essai).toContain("p || '/a...b.pdf', p || '/.cache.pdf'")
  })

  it('la migration pose les trois contraintes, chacune avec les quatre règles', () => {
    const nom = '20261112220000_chemin_dans_son_dossier.sql'
    const prete = new URL(`../../supabase/preparees/${nom}`, import.meta.url)
    const appliquee = new URL(`../../supabase/schema/${nom}`, import.meta.url)
    const texte = readFileSync(existsSync(appliquee) ? appliquee : prete, 'utf8')
    for (const [contrainte, colonne] of [
      ['pieces_storage_path_dans_son_dossier', 'storage_path'],
      ['pieces_lisible_path_dans_son_dossier', 'lisible_path'],
      ['documents_divers_storage_path_dans_son_dossier', 'storage_path'],
    ] as const) {
      const debut = texte.indexOf(`add constraint ${contrainte} check (`)
      expect(debut, contrainte).toBeGreaterThan(0)
      const corps = texte.slice(debut, texte.indexOf(') not valid', debut))
      expect(corps).toContain(`split_part(${colonne}, '/', 1) = dossier_id::text`)
      expect(corps).toContain(`${colonne} ~ '^[^/]+(/[^/]+)+$'`)
      expect(corps).toContain(`${colonne} !~ '(^|/)[.][.]?(/|$)'`)
      expect(corps).toContain(`${colonne} !~ '[%?#[:cntrl:]]'`)
      expect(corps).toContain(`strpos(${colonne}, chr(92)) = 0`)
      expect(texte).toContain(`validate constraint ${contrainte};`)
    }
    // Aucun mot qui retiendrait l'outil, aucune barre oblique inverse que les outils réinterpréteraient.
    expect(texte).not.toMatch(/\b(drop|delete|truncate)\b/i)
    expect(texte).not.toContain(BARRE_INVERSE)
  })
})
