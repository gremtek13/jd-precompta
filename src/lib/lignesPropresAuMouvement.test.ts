import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fichiersDuSchema } from '../test/schema'

// LES LIGNES D'UN MOUVEMENT QUE LE RELEVÉ TOUCHE SONT SES LIGNES PROPRES (le lot de R1, chantier EC-Q3, ligne 28.6 ;
// migration `lignes_propres_au_mouvement`). Un mouvement libéré peut porter encore les lignes d'une vente facturée — la
// banque d'un encaissement contre-passé sans mouvement, celle de sa contre-passation, celles d'un encaissement retiré
// jusqu'à leur retrait —, qui ne s'écrivent et ne se retirent que par leurs deux fonctions (G5). Une fonction du relevé,
// ou le navigateur, qui supprimerait, jugerait ou vérifierait les lignes d'un mouvement en les comptant butait sur G5 (le
// mouvement ne se classait plus), ou refuserait à tort ; c'est le défaut que la migration a fermé dans les dix-huit
// fonctions du relevé, et `retirerContrepartieBanque` dans le navigateur.
//
// Ce garde-ci voit la PROCHAINE copie : il part de TOUTES les fonctions de l'export (la dernière définition de chacune,
// celle que la base exécute) et de tout le code du navigateur, pas d'une liste — une migration qui redéfinirait l'une
// des dix-huit depuis un corps d'avant (PC4 en reprendra), ou une fonction neuve qui supprimerait les lignes d'un
// mouvement, vire au rouge ici avant d'être collée. Un plancher distingue « aucune faute » d'un lecteur devenu aveugle.

const RACINE = new URL('../../', import.meta.url)

// La dernière définition de chaque fonction de l'export, quel que soit le délimiteur de son corps (comme celui de
// planComptable.test.ts) : le corps seul, ce que `pg_proc.prosrc` porte en base.
function dernieresDefinitions(): Map<string, string> {
  const corps = new Map<string, string>()
  for (const { texte } of fichiersDuSchema()) {
    for (const m of texte.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) {
      const ouverture = /\bas\s+(\$\w*\$)/i.exec(texte.slice(m.index))
      if (!ouverture) throw new Error(`Corps de ${m[1]} introuvable dans le schéma exporté.`)
      const debut = m.index + ouverture.index + ouverture[0].length
      const fin = texte.indexOf(ouverture[1], debut)
      if (fin < 0) throw new Error(`Fin du corps de ${m[1]} introuvable dans le schéma exporté.`)
      corps.set(m[1], texte.slice(debut, fin))
    }
  }
  return corps
}

/** Les instructions d'un corps qui désignent des lignes d'écriture par leur mouvement (« ligne_bancaire_id = … » ou
 *  « in (…) ») — une suppression, une lecture, une insertion qui les recopierait ; jamais la liste de colonnes d'une
 *  insertion, ni un argument (`p_ligne_bancaire_id`), qui nomment le mouvement sans rien désigner. */
function instructionsSurLesLignesDUnMouvement(corps: string): string[] {
  return corps.split(';').filter((instruction) =>
    /\becritures_brouillon\b/.test(instruction) && /\bligne_bancaire_id\s*(?:=|in\s*\()/i.test(instruction))
}

/** Ce qu'une telle instruction doit écarter : les lignes d'une vente facturée, qui portent une facture ou un encaissement. */
function ecarteLaVenteFacturee(instruction: string): boolean {
  return /\bfacture_id\s+is\s+null\b/i.test(instruction) && /\bencaissement_id\s+is\s+null\b/i.test(instruction)
}

const DIX_HUIT = [
  'affecter_mouvement_bancaire', 'classer_virement_personnel', 'ecrire_mouvement_compte_bilan', 'rapprocher_cotisation',
  'rapprocher_declaration_tva', 'rapprocher_echeance_emprunt', 'regler_pieces_par_mouvement',
  'retirer_affectation_mouvement_bancaire', 'retirer_declaration_tva', 'retirer_echeance_emprunt',
  'retirer_mouvement_compte_bilan', 'retirer_rapprochement_cotisation', 'retirer_rapprochement_declaration_tva',
  'retirer_reglement_groupe', 'retirer_ventilation_mouvement_bancaire', 'retirer_virement_personnel',
  'supprimer_echeance_cotisation', 'ventiler_mouvement_bancaire',
]

describe('les fonctions de la base ne touchent que les lignes propres d’un mouvement', () => {
  const definitions = dernieresDefinitions()
  const visees = [...definitions].flatMap(([nom, corps]) =>
    instructionsSurLesLignesDUnMouvement(corps).map((instruction) => ({ nom, instruction })))

  it('chaque instruction qui désigne les lignes d’un mouvement écarte celles d’une vente facturée', () => {
    const fautes = visees.filter((v) => !ecarteLaVenteFacturee(v.instruction))
      .map((v) => `${v.nom} : ${v.instruction.replace(/\s+/g, ' ').trim().slice(0, 120)}`)
    expect(fautes).toEqual([])
  })

  it('le plancher : les dix-huit du relevé, et les deux de la vente facturée, quarante-six instructions', () => {
    // Au 21/10/2026 : trois instructions dans chacune des sept qui classent et écrivent (juger, supprimer, vérifier),
    // deux dans le règlement groupé et dans chacune des dix qui déclassent, plus les deux de la vente facturée qui
    // désignent un mouvement source (`ecrire_vente_facturee` qui en remplace les lignes, `retirer_ecriture_vente_facturee`
    // qui les compte puis les retire).
    expect(visees.length).toBeGreaterThanOrEqual(46)
    const nommees = new Set(visees.map((v) => v.nom))
    for (const nom of [...DIX_HUIT, 'ecrire_vente_facturee', 'retirer_ecriture_vente_facturee']) expect(nommees, nom).toContain(nom)
  })

  it('le lecteur voit une suppression, une lecture, une insertion qui recopie, pas une liste de colonnes ; et le filtre oublié', () => {
    const corps = `begin
      delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;
      select sum(montant) into v from public.ecritures_brouillon where ligne_bancaire_id in (select id from x);
      insert into public.ecritures_brouillon (dossier_id, ligne_bancaire_id) values (d, p_ligne_bancaire_id);
      insert into public.ecritures_brouillon (dossier_id, compte) select dossier_id, compte from public.ecritures_brouillon
        where ligne_bancaire_id = m;
      update public.lignes_bancaires set statut = 'rapprochee' where id = p_ligne_bancaire_id;
    end`
    const vues = instructionsSurLesLignesDUnMouvement(corps)
    expect(vues).toHaveLength(3)
    expect(vues.map(ecarteLaVenteFacturee)).toEqual([false, false, false])
    expect(ecarteLaVenteFacturee('delete from public.ecritures_brouillon where ligne_bancaire_id = m and piece_id is null '
      + 'and facture_id is null and encaissement_id is null')).toBe(true)
    expect(ecarteLaVenteFacturee('… and facture_id is null')).toBe(false)
    expect(ecarteLaVenteFacturee('… and encaissement_id is null')).toBe(false)
  })
})

// LE NAVIGATEUR. Toute suppression d'écritures que le code de l'application adresse aux lignes d'un MOUVEMENT, sans les
// restreindre à une pièce, écarte celles d'une vente facturée. Restreinte à une pièce, elle ne peut pas les toucher :
// aucune ligne d'une vente facturée ne porte de pièce (`ecrire_vente_facturee` les écrit sans pièce, G5 refuse toute
// autre écriture).
function sources(): { chemin: string; texte: string }[] {
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
  parcourir(new URL('src/', RACINE), 'src/')
  return trouves
}

/** La chaîne d'appels qui suit un `.from('ecritures_brouillon')`, appel par appel, parenthèses appariées. */
function chaineDesAppels(texte: string, debut: number): string[] {
  const appels: string[] = []
  let i = debut
  for (;;) {
    const suite = /^\s*\.(\w+)\(/.exec(texte.slice(i))
    if (!suite) return appels
    let profondeur = 0
    let j = i + suite[0].length - 1
    for (; j < texte.length; j++) {
      if (texte[j] === '(') profondeur++
      else if (texte[j] === ')' && --profondeur === 0) break
    }
    appels.push(texte.slice(i, j + 1).trim())
    i = j + 1
  }
}

/** Une suppression adressée aux lignes d'un mouvement, sans pièce : elle doit porter les deux filtres. */
function suppressionsParMouvement(texte: string): { appels: string[]; ecarte: boolean }[] {
  const trouvees: { appels: string[]; ecarte: boolean }[] = []
  for (const m of texte.matchAll(/\.from\(\s*['"]ecritures_brouillon['"]\s*\)/g)) {
    const appels = chaineDesAppels(texte, m.index + m[0].length)
    const delete_ = appels.some((a) => /^\.delete\(/.test(a))
    const parMouvement = appels.some((a) => /^\.(eq|in)\(\s*['"]ligne_bancaire_id['"]/.test(a))
    const parPiece = appels.some((a) => /^\.(eq|in)\(\s*['"]piece_id['"]/.test(a))
    if (!delete_ || !parMouvement || parPiece) continue
    const filtre = (colonne: string) => appels.some((a) => new RegExp(`^\\.is\\(\\s*['"]${colonne}['"]\\s*,\\s*null\\s*\\)$`).test(a))
    trouvees.push({ appels, ecarte: filtre('facture_id') && filtre('encaissement_id') })
  }
  return trouvees
}

describe('le navigateur ne supprime que les lignes propres d’un mouvement', () => {
  it('chaque suppression adressée aux lignes d’un mouvement écarte celles d’une vente facturée — et il y en a une', () => {
    const toutes = sources().flatMap(({ chemin, texte }) => suppressionsParMouvement(texte).map((s) => ({ chemin, ...s })))
    expect(toutes.filter((s) => !s.ecarte).map((s) => `${s.chemin} : ${s.appels.join('')}`)).toEqual([])
    // Le plancher : `retirerContrepartieBanque`, en engagement (src/lib/contrepartieBanque.ts).
    expect(toutes.map((s) => s.chemin)).toContain('src/lib/contrepartieBanque.ts')
  })

  it('le lecteur suit la chaîne, et voit le filtre oublié ou une suppression restreinte à une pièce', () => {
    const bonne = "await supabase.from('ecritures_brouillon').delete().eq('ligne_bancaire_id', id)\n  .is('facture_id', null).is('encaissement_id', null)"
    expect(suppressionsParMouvement(bonne)).toEqual([{ appels: [".delete()", ".eq('ligne_bancaire_id', id)", ".is('facture_id', null)", ".is('encaissement_id', null)"], ecarte: true }])
    expect(suppressionsParMouvement("await supabase.from('ecritures_brouillon').delete().eq('ligne_bancaire_id', id)")[0].ecarte).toBe(false)
    expect(suppressionsParMouvement("supabase.from('ecritures_brouillon').delete().eq('ligne_bancaire_id', id).is('facture_id', null)")[0].ecarte).toBe(false)
    expect(suppressionsParMouvement("supabase.from('ecritures_brouillon').delete().eq('piece_id', p).eq('ligne_bancaire_id', id)")).toEqual([])
    expect(suppressionsParMouvement("supabase.from('ecritures_brouillon').select('id').eq('ligne_bancaire_id', id)")).toEqual([])
  })
})
