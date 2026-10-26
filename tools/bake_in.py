# bake a settings.json (Copy settings) into cat-stretch.html as built-in defaults
import json, re, sys
J=json.load(open(sys.argv[1])); f='/home/claude/cat-stretch.html'; s=open(f).read()
def num(v):
    if isinstance(v,float): v=round(v,4); return '%g' % v
    return json.dumps(v)
OBS={'browColor','brows','savedAt','shapes','eyeLooks'}
top={k:v for k,v in J.items() if k not in OBS}
items=[f"{k}:{num(v)}" for k,v in top.items()]; lines=[]; cur='  '
for it in items:
    if len(cur)+len(it)>112: lines.append(cur.rstrip()); cur='  '
    cur+=it+', '
lines.append(cur.rstrip().rstrip(','))
a=s.index("Object.assign(DEFAULTS, {\n"); b=s.index("\n});\n", a)
s=s[:a]+"Object.assign(DEFAULTS, {\n"+'\n'.join(lines)+s[b:]
if 'shapes' in J:
    sh='\n'.join(f"  {g}: "+'{ '+', '.join(f"{k}:{num(v)}" for k,v in d.items() if not k.startswith('brow'))+' },' for g,d in J['shapes'].items())
    a=s.index("const SHAPE_PRESET = {\n"); b=s.index("\n};\n", a)
    s=s[:a]+"const SHAPE_PRESET = {\n"+sh+s[b:]
def P(pts): return 'pts8(' + ', '.join(','.join(num(v) for v in q) for q in pts) + ')'
done=[]
for lid,d in (J.get('eyeLooks') or {}).items():
    e=d['eyes']
    if d.get('sep') and len(e)>1:
        new=f"two({P(e[0]['pts'])}, {P(e[1]['pts'])}" + (f", {num(e[0]['pr'])}, {num(e[1]['pr'])}" if (e[0]['pr'],e[1]['pr'])!=(1,1) else '') + ")"
    else:
        new=f"one({P(e[0]['pts'])}" + (f", {num(e[0]['pr'])}" if e[0]['pr']!=1 else '') + ")"
    m=re.search(r"\['%s',\s+'[^']*',\s+[\d.]+,\s+\w+,\s+[^,]+,\s+(one\(.*?\)|two\(.*?\)), (mo\(|\(\) =>|t =>)" % lid, s)
    assert m, lid
    s=s[:m.start(1)]+new+s[m.end(1):]; done.append(lid)
open(f,'w').write(s); print('built in:', done)
