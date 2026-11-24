import re,sys,subprocess,glob,os
P=sys.argv[1]
out=subprocess.run(['/usr/lib/postgresql/16/bin/psql','-h','/tmp','-p','5544','-U','postgres','-d','g','-tAF','|','-c',"select table_name,column_name from information_schema.columns where table_schema='public'"],capture_output=True,text=True).stdout
cols={}
for l in out.splitlines():
    t,c=l.split('|'); cols.setdefault(t,set()).add(c)
fk=subprocess.run(['/usr/lib/postgresql/16/bin/psql','-h','/tmp','-p','5544','-U','postgres','-d','g','-tAF','|','-c',"select conrelid::regclass::text, conname, confrelid::regclass::text from pg_constraint where contype='f'"],capture_output=True,text=True).stdout
fks={}; 
for l in fk.splitlines():
    a,b,c=l.split('|'); fks[b]=c.replace('public.','')
bad=0
def split_top(s):
    parts=[];d=0;cur=''
    for ch in s:
        if ch in '([{': d+=1
        if ch in ')]}': d-=1
        if ch==',' and d==0: parts.append(cur);cur=''
        else: cur+=ch
    if cur.strip(): parts.append(cur)
    return parts
def check_select(tbl,sel,file):
    global bad
    for p in split_top(sel):
        p=p.strip()
        if not p or p=='*': continue
        m=re.match(r'^(?:(\w+):)?(\w+)(?:!(\w+))?(?:\((.*)\))?$',p,re.S)
        if not m: print('?? unparsed',file,p); continue
        alias,name,hint,inner=m.groups()
        if hint=='inner': hint=None
        if inner is not None:
            tgt=fks.get(hint) if hint else (name if name in cols else None)
            if hint and hint not in fks: print('BAD FK',file,hint); bad+=1; continue
            if tgt is None:
                # relationship name = table name; verify table exists
                print('BAD embed table',file,tbl,name); bad+=1; continue
            check_select(tgt,inner,file)
        else:
            if name not in cols.get(tbl,()): print('BAD COLUMN',file,tbl,name); bad+=1
def objkeys(s):
    keys=[]
    for p in split_top(s):
        p=p.strip()
        if not p or p.startswith('...'): continue
        m=re.match(r'^["\']?(\w+)["\']?\s*(:|$)',p)
        if m: keys.append(m.group(1))
    return keys
for f in glob.glob(P+'/**/*.ts*',recursive=True):
    src=open(f).read()
    for m in re.finditer(r'\.from\(\s*["\'](\w+)["\']\s*\)',src):
        tbl=m.group(1)
        if tbl not in cols: print('BAD TABLE',f,tbl); bad+=1; continue
        seg=src[m.end():m.end()+1500]
        # stop at next .from(
        n=seg.find('.from('); seg=seg if n<0 else seg[:n]
        for op in re.finditer(r'\.(select|insert|update|upsert|eq|neq|in|is|gte|lt|lte|gt|order|ilike|overlaps)\(',seg):
            i=op.end(); d=1; j=i
            while j<len(seg) and d: 
                d+= seg[j] in '(' ; d-= seg[j] in ')'; j+=1
            arg=seg[i:j-1]; name=op.group(1)
            if name=='select':
                m2=re.match(r'\s*["`\']([^"`\']*)["`\']',arg)
                if m2: check_select(tbl,m2.group(1),f)
                elif arg.strip().startswith('cols'): pass
            elif name in('insert','update','upsert'):
                a=arg.strip()
                if a.startswith('{'):
                    for k in objkeys(a[1:a.rfind('}')]):
                        if k not in cols[tbl]: print('BAD KEY',os.path.relpath(f,P),tbl,name,k); bad+=1
            elif name in('eq','neq','in','is','gte','lt','lte','gt','order','ilike','overlaps'):
                m2=re.match(r'\s*["\'](\w+)["\']',arg)
                if m2 and m2.group(1) not in cols[tbl]: print('BAD FILTER COL',os.path.relpath(f,P),tbl,name,m2.group(1)); bad+=1
print('problems:',bad)
