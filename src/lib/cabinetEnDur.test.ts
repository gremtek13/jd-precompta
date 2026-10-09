import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// AUCUN CABINET NOMMÉ EN DUR dans ce que l'application dit ou envoie. Elle est multi-cabinets dès l'origine (`cabinets`,
// `cabinet_admins`) ; la consigne de l'assistant nommait pourtant « le cabinet JD Consult » pour tous, et quatre écrans
// client disaient « contacte JD Consult » à un client de n'importe quel cabinet. Le nom d'un cabinet se lit dans sa ligne
// (`cabinets.nom`), jamais dans le code.
//
// Le scanner part de TOUT le code exécuté — `src/` et `supabase/functions/`, tests et fabriques exceptés —, et ne lit que
// le code : un commentaire peut raconter l'histoire d'un cabinet, une chaîne ou un gabarit, non. Un plancher distingue
// « zéro faute » d'« aveugle ».

const RACINE = new URL('../../', import.meta.url).pathname
const NOM_EN_DUR = /JD\s*Consult/i

function fichiers(dossier: string): string[] {
  return readdirSync(join(RACINE, dossier)).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(join(RACINE, chemin)).isDirectory()) return chemin === join('src', 'test') ? [] : fichiers(chemin)
    return /\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom) ? [chemin] : []
  })
}

// Le code sans ses commentaires : les blocs `/* … */` (et `{/* … */}` en JSX), puis les lignes entièrement en
// commentaire. Un `//` en fin de ligne n'est pas coupé : il pourrait être dans une chaîne (une adresse `https://`).
function sansCommentaires(texte: string): string {
  return texte.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
}

describe('aucun cabinet nommé en dur', () => {
  const lus = [...fichiers('src'), ...fichiers(join('supabase', 'functions'))]

  it('lit tout le code exécuté', () => {
    expect(lus.length).toBeGreaterThan(200)
    expect(lus).toContain(join('supabase', 'functions', 'agent-comptable', 'index.ts'))
    expect(lus).toContain(join('src', 'pages', 'ClientHome.tsx'))
  })

  it('ne trouve le nom d’aucun cabinet dans le code', () => {
    const fautes = lus.filter((f) => NOM_EN_DUR.test(sansCommentaires(readFileSync(join(RACINE, f), 'utf8'))))
    expect(fautes).toEqual([])
  })

  // Le scanner sait voir : une chaîne, un gabarit et du texte JSX le portent ; un commentaire, non.
  it('voit un nom planté dans une chaîne, et pas dans un commentaire', () => {
    expect(NOM_EN_DUR.test(sansCommentaires('const a = "contacte JD Consult."'))).toBe(true)
    expect(NOM_EN_DUR.test(sansCommentaires('const p = `du cabinet JD Consult, pour ${x}`'))).toBe(true)
    expect(NOM_EN_DUR.test(sansCommentaires('return <p>contacte JD  Consult</p>'))).toBe(true)
    expect(NOM_EN_DUR.test(sansCommentaires('// le cabinet JD Consult a un logo\nconst a = 1'))).toBe(false)
    expect(NOM_EN_DUR.test(sansCommentaires('{/* JD Consult */}\nconst a = 1'))).toBe(false)
  })
})
