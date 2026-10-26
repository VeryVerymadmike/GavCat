# bake settings into cat-stretch.html as built-in defaults
# from a settings.json (Copy settings): python3 tools/bake_in.py settings.json; tools/edit_server.py calls bake() on every change
import json, os, re, sys
SRC = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cat-stretch.html'))
OBS = {'browColor','brows','savedAt','shapes','eyeLooks'}
LEG_KEY = re.compile(r'[fb][nf][1-4][xy]')   # leg point offsets (fn1x … bf4y)
def num(v):
    if isinstance(v,float): v=round(v,4); return '%g' % v
    return json.dumps(v).replace('</', '<\\/')
def ident(k):
    assert re.fullmatch(r'[A-Za-z_]\w*', k), 'bad key %r' % k
    return k
def P(pts): return 'pts8(' + ', '.join(','.join(num(v) for v in q) for q in pts) + ')'
def bake(J, f=SRC):
    """write J into f; returns True when the file changed"""
    old=open(f).read(); s=old
    top={ident(k):v for k,v in J.items() if k not in OBS}
    items=[f"{k}:{num(v)}" for k,v in top.items()]; lines=[]; cur='  '
    for it in items:
        if len(cur)+len(it)>112: lines.append(cur.rstrip()); cur='  '
        cur+=it+', '
    lines.append(cur.rstrip().rstrip(','))
    a=s.index("Object.assign(DEFAULTS, {\n"); b=s.index("\n});\n", a)
    s=s[:a]+"Object.assign(DEFAULTS, {\n"+'\n'.join(lines)+s[b:]
    if 'shapes' in J:
        keep=lambda k,v: not k.startswith('brow') and not (LEG_KEY.fullmatch(k) and v==0)   # unmoved leg points are left out
        sh='\n'.join(f"  {ident(g)}: "+'{ '+', '.join(f"{ident(k)}:{num(v)}" for k,v in d.items() if keep(k,v))+' },' for g,d in J['shapes'].items())
        a=s.index("const SHAPE_PRESET = {\n"); b=s.index("\n};\n", a)
        s=s[:a]+"const SHAPE_PRESET = {\n"+sh+s[b:]
    for lid,d in (J.get('eyeLooks') or {}).items():
        e=d['eyes']
        if d.get('sep') and len(e)>1:
            new=f"two({P(e[0]['pts'])}, {P(e[1]['pts'])}" + (f", {num(e[0]['pr'])}, {num(e[1]['pr'])}" if (e[0]['pr'],e[1]['pr'])!=(1,1) else '') + ")"
        else:
            new=f"one({P(e[0]['pts'])}" + (f", {num(e[0]['pr'])}" if e[0]['pr']!=1 else '') + ")"
        m=re.search(r"\['%s',\s+'[^']*',\s+[\d.]+,\s+\w+,\s+[^,]+,\s+(one\(.*?\)|two\(.*?\)), (mo\(|\(\) =>|t =>)" % ident(lid), s)
        assert m, lid
        s=s[:m.start(1)]+new+s[m.end(1):]
    if s==old: return False
    open(f,'w').write(s); return True

if __name__ == '__main__':
    print('cat-stretch.html updated' if bake(json.load(open(sys.argv[1]))) else 'no change')
