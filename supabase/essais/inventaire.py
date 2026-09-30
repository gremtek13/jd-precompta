#!/usr/bin/env python3
"""Dit si l'export du schéma contient TOUT ce que la base contient — nom par nom.

POURQUOI CE FICHIER EXISTE. Deux contrôles gardent déjà l'export, et aucun ne pouvait voir ce que
celui-ci a trouvé le 29/09/2026 :

  - le contrôle de dérive de `supabase/schema/README.md` compare les FICHIERS aux MIGRATIONS. Il dit
    que l'historique est bien recopié, pas qu'il reconstruit le schéma ;
  - `socle.py` compare le socle à la base, au caractère près — mais seulement les objets que le socle
    déclare. Ce qui a été créé hors migration ET hors socle n'est dans aucune de ses deux moitiés.

Or c'est exactement ce qui arrive à une colonne ajoutée par `execute_sql` à une table que les
migrations créent : la table est dans l'export, la colonne non. Mesuré ce jour-là : 751 objets dans la
base, 740 dans l'export, et les onze qui manquaient — `categories.compte_comptable` et `poste_2035`,
`pieces.storage_hash`, `dossiers.assujetti_tva`, l'adresse de collecte par e-mail — sont maintenant
dans `socle/2_objets_sans_migration.sql`.

COMMENT ÇA MARCHE. Les deux moitiés rendent le même INVENTAIRE, une ligne par objet :

    colonne|table.colonne          contrainte|table.nom      index|table.nom (hors contraintes)
    declencheur|table.nom          policy|table.nom          fonction|nom/nombre d'arguments
    rls|table (RLS activée)

    1. jouer `supabase/essais/inventaire.sql` (outil MCP `execute_sql`) → nombre et empreinte
    2. python3 supabase/essais/inventaire.py         → les mêmes, tirés des fichiers de l'export
    3. égales ⇒ rien n'existe en base qui ne soit dans l'export ; sinon `--detail` des deux côtés

Cette moitié-ci REJOUE l'export dans l'ordre (migrations par nom, puis le socle par nom) : un
`drop constraint`, un `drop policy` ou un `drop table` retire ce qu'il retire, un `create or replace`
ne compte qu'une fois.

CE QU'IL NE VOIT PAS, dit plutôt que promis : il compare des NOMS. Un type de colonne, une valeur par
défaut, l'expression d'une policy, le corps d'une fonction ou un droit d'exécution changés hors
migration lui échappent — pour le socle, `socle.py` compare les définitions ; pour le reste, seul un
rejeu réel de l'export dans une base vide le dirait. Le nom d'une contrainte anonyme est DÉDUIT des
règles de Postgres (`table_col_check`, `table_col_fkey`, `table_a_b_key`…) : une règle mal déduite se
voit, puisqu'elle fait diverger les deux moitiés.
"""
import hashlib
import re
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1] / 'schema'


def fin_litteral(s: str, i: int) -> int:
    """`s[i]` ouvre un littéral `'…'` : rend l'indice de la quote fermante (`''` est une quote)."""
    j = i + 1
    while True:
        j = s.index("'", j)
        if j + 1 < len(s) and s[j + 1] == "'":
            j += 2
            continue
        return j


def groupe(sql: str, pos: int) -> str:
    """Le contenu du groupe de parenthèses ouvert en `pos`, parenthèses appariées, littéraux sautés."""
    profondeur = 0
    i = pos
    while i < len(sql):
        c = sql[i]
        if c == "'":
            i = fin_litteral(sql, i)
        elif c == '(':
            profondeur += 1
        elif c == ')':
            profondeur -= 1
            if profondeur == 0:
                return sql[pos + 1:i]
        i += 1
    raise ValueError(f'parenthèse jamais refermée : {sql[pos:pos + 60]!r}')


def entrees(corps: str) -> list[str]:
    """Découpe sur les virgules de PREMIER niveau : `numeric(10, 2)` ne coupe pas une colonne."""
    res: list[str] = []
    profondeur = 0
    courant = ''
    i = 0
    while i < len(corps):
        c = corps[i]
        if c == "'":
            j = fin_litteral(corps, i)
            courant += corps[i:j + 1]
            i = j + 1
            continue
        if c == '(':
            profondeur += 1
        elif c == ')':
            profondeur -= 1
        if c == ',' and profondeur == 0:
            res.append(courant)
            courant = ''
        else:
            courant += c
        i += 1
    if courant.strip():
        res.append(courant)
    return res


def instructions(texte: str) -> list[str]:
    """Les instructions d'un fichier : lignes de commentaire retirées, découpe sur les `;` hors
    littéraux et hors corps `$tag$ … $tag$` — un corps de fonction porte ses propres `;`.

    Cette protection est DÉFENSIVE, et sa mutation survit : aucun corps de fonction de l'export ne
    contient aujourd'hui d'instruction de définition, donc le couper en morceaux ne crée ni ne
    retire aucun objet. Elle sert le jour où un corps contiendra un `alter table` ou un
    `create policy`, qui passerait sinon pour une instruction de l'export.
    """
    sql = '\n'.join(l for l in texte.split('\n') if not l.lstrip().startswith('--'))
    res: list[str] = []
    courant = ''
    i = 0
    while i < len(sql):
        c = sql[i]
        if c == "'":
            j = fin_litteral(sql, i)
            courant += sql[i:j + 1]
            i = j + 1
            continue
        if c == '$':
            balise = re.match(r'\$\w*\$', sql[i:])
            if balise:
                fin = sql.index(balise.group(0), i + len(balise.group(0))) + len(balise.group(0))
                courant += sql[i:fin]
                i = fin
                continue
        if c == ';':
            res.append(courant.strip())
            courant = ''
        else:
            courant += c
        i += 1
    if courant.strip():
        res.append(courant.strip())
    return [r for r in res if r]


def inconnue(fichier: Path, forme: str, texte: str) -> SystemExit:
    """Une forme que l'export n'a jamais portée : on s'arrête plutôt que de deviner.

    Le nom d'une contrainte anonyme se DÉDUIT de règles de Postgres (`table_col_check`,
    `table_col_fkey`…) ; une règle déduite pour une forme que rien n'exerce serait du code que rien
    ne vérifie, et une règle fausse ferait diverger les deux moitiés sans dire pourquoi. Le jour où
    l'une apparaît, on l'écrit ici et on la vérifie contre `inventaire.sql`.
    """
    return SystemExit(f'{fichier.name} : {forme} jamais rencontrée dans l\'export, règle à écrire : {texte[:80]}')


def inventaire(fichiers: list[Path]) -> set[str]:
    inv: set[str] = set()
    colonnes: dict[str, list[str]] = {}
    rls: set[str] = set()

    def contraintes_de_colonne(t: str, col: str, definition: str) -> None:
        if re.search(r'\bprimary key\b', definition):
            inv.add(f'contrainte|{t}.{t}_pkey')
        if re.search(r'\bunique\b', definition):
            inv.add(f'contrainte|{t}.{t}_{col}_key')
        if re.search(r'\breferences\b', definition):
            inv.add(f'contrainte|{t}.{t}_{col}_fkey')
        for _ in re.finditer(r'\bcheck ?\(', definition):
            inv.add(f'contrainte|{t}.{t}_{col}_check')

    for f in fichiers:
        for brute in instructions(f.read_text(encoding='utf-8')):
            s = re.sub(r'\s+', ' ', brute).strip()
            low = s.lower()

            m = re.match(r'create table (?:if not exists )?(?:public\.)?"?(\w+)"? \(', low)
            if m:
                t = m.group(1)
                corps = entrees(groupe(low, low.index('(')))
                cols = []
                for e in corps:
                    e = e.strip()
                    if re.match(r'(constraint|primary|unique|check|foreign|exclude|like)\b', e):
                        continue
                    cm = re.match(r'"?(\w+)"? ', e)
                    if cm:
                        cols.append(cm.group(1))
                colonnes[t] = cols
                for e in corps:
                    e = e.strip()
                    nm = re.match(r'constraint "?(\w+)"? ', e)
                    if nm:
                        inv.add(f'contrainte|{t}.{nm.group(1)}')
                    elif e.startswith('primary key'):
                        inv.add(f'contrainte|{t}.{t}_pkey')
                    elif e.startswith('unique'):
                        cs = [c.strip().strip('"') for c in groupe(e, e.index('(')).split(',')]
                        inv.add(f'contrainte|{t}.{t}_{"_".join(cs)}_key')
                    elif e.startswith('check') or e.startswith('foreign key'):
                        raise inconnue(f, 'une contrainte anonyme de niveau table', e)
                    else:
                        cm = re.match(r'"?(\w+)"? ', e)
                        if cm:
                            contraintes_de_colonne(t, cm.group(1), e)
                continue

            m = re.match(r'alter table (?:if exists )?(?:only )?(?:public\.)?"?(\w+)"? (.*)$', low, re.S)
            if m:
                t = m.group(1)
                for a in entrees(m.group(2)):
                    a = a.strip()
                    if a.startswith('enable row level security'):
                        rls.add(t)
                    elif a.startswith('disable row level security'):
                        rls.discard(t)
                    elif (dm := re.match(r'drop constraint (?:if exists )?"?(\w+)"?', a)):
                        inv.discard(f'contrainte|{t}.{dm.group(1)}')
                    elif (am := re.match(r'add constraint "?(\w+)"? ', a)):
                        inv.add(f'contrainte|{t}.{am.group(1)}')
                    elif a.startswith('add primary key'):
                        inv.add(f'contrainte|{t}.{t}_pkey')
                    elif re.match(r'add (unique|check|foreign key)', a):
                        raise inconnue(f, 'une contrainte anonyme ajoutée par alter', a)
                    elif (cm := re.match(r'add column (?:if not exists )?"?(\w+)"? (.*)$', a, re.S)):
                        colonnes.setdefault(t, []).append(cm.group(1))
                        contraintes_de_colonne(t, cm.group(1), cm.group(2))
                    elif re.match(r'(drop|rename) column', a):
                        raise inconnue(f, 'une colonne retirée ou renommée', a)
                continue

            m = re.match(r'drop table (?:if exists )?(?:public\.)?"?(\w+)"?', low)
            if m:
                t = m.group(1)
                inv.difference_update({x for x in inv if x.split('|', 1)[1].startswith(t + '.')})
                colonnes.pop(t, None)
                rls.discard(t)
                continue

            m = re.match(r'create (?:unique )?index (?:concurrently )?(?:if not exists )?"?(\w+)"? on (?:only )?(?:public\.)?"?(\w+)"?', low)
            if m:
                inv.add(f'index|{m.group(2)}.{m.group(1)}')
                continue
            m = re.match(r'drop index (?:concurrently )?(?:if exists )?(?:public\.)?"?(\w+)"?', low)
            if m:
                inv.difference_update({x for x in inv if x.startswith('index|') and x.endswith('.' + m.group(1))})
                continue

            m = re.match(r'create (?:or replace )?(?:constraint )?trigger "?(\w+)"? .*? on (?:public\.)?"?(\w+)"?', low)
            if m:
                inv.add(f'declencheur|{m.group(2)}.{m.group(1)}')
                continue
            m = re.match(r'drop trigger (?:if exists )?"?(\w+)"? on (?:public\.)?"?(\w+)"?', low)
            if m:
                inv.discard(f'declencheur|{m.group(2)}.{m.group(1)}')
                continue

            # Les policies gardent leur casse et leurs espaces : « membres peuvent lire leurs
            # documents » est un nom, pas une phrase à normaliser.
            m = re.match(r'create policy (?:"([^"]+)"|(\w+)) on (?:(\w+)\.)?"?(\w+)"?', s, re.I)
            if m:
                inv.add(f'policy|{m.group(4)}.{m.group(1) or m.group(2)}')
                continue
            m = re.match(r'drop policy (?:if exists )?(?:"([^"]+)"|(\w+)) on (?:(\w+)\.)?"?(\w+)"?', s, re.I)
            if m:
                inv.discard(f'policy|{m.group(4)}.{m.group(1) or m.group(2)}')
                continue
            m = re.match(r'alter policy (?:"([^"]+)"|(\w+)) on (?:(\w+)\.)?"?(\w+)"? rename to (?:"([^"]+)"|(\w+))', s, re.I)
            if m:
                inv.discard(f'policy|{m.group(4)}.{m.group(1) or m.group(2)}')
                inv.add(f'policy|{m.group(4)}.{m.group(5) or m.group(6)}')
                continue

            m = re.match(r'create (?:or replace )?function (?:public\.)?"?(\w+)"?\s*\(', low)
            if m:
                arguments = [a for a in entrees(groupe(low, low.index('('))) if a.strip()]
                inv.add(f'fonction|{m.group(1)}/{len(arguments)}')
                continue
            m = re.match(r'drop function (?:if exists )?(?:public\.)?"?(\w+)"?\s*(\()?', low)
            if m:
                if m.group(2):
                    arguments = [a for a in entrees(groupe(low, low.index('('))) if a.strip()]
                    inv.discard(f'fonction|{m.group(1)}/{len(arguments)}')
                else:
                    inv.difference_update({x for x in inv if x.startswith(f'fonction|{m.group(1)}/')})
                continue

    inv.update(f'rls|{t}' for t in rls)
    inv.update(f'colonne|{t}.{c}' for t, cs in colonnes.items() for c in cs)
    return inv


def main() -> int:
    fichiers = sorted(RACINE.glob('*.sql')) + sorted((RACINE / 'socle').glob('*.sql'))
    lignes = sorted(inventaire(fichiers))
    # Un plancher : un inventaire vide aurait l'empreinte d'une liste vide, et « l'export ne contient
    # rien » ne doit pas pouvoir passer pour « l'export concorde ». 44 tables au 29/09/2026.
    if len([l for l in lignes if l.startswith('rls|')]) < 40:
        print(f'inventaire anormalement court ({len(lignes)} lignes) : lecture aveugle ?', file=sys.stderr)
        return 1
    if '--detail' in sys.argv:
        print('\n'.join(lignes))
        return 0
    empreinte = hashlib.md5('\n'.join(lignes).encode('utf-8')).hexdigest()
    print(f'{len(fichiers)} fichiers   {len(lignes)} objets   empreinte {empreinte}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
