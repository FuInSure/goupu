"""Create factual records from archived official sources. No imputation of measurements."""
import json, re, unicodedata
from html.parser import HTMLParser
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
SRC6 = 'https://zwgk.mct.gov.cn/zfxxgkml/qt/202012/t20201206_918486.html'
SRC8 = 'https://www.forestry.gov.cn/main/4815/20191016/173000319923859.html'
SRC5 = 'https://aah.bucea.edu.cn/zlxz/zyzl/123724.htm'
GUIDE = 'https://young.dpm.org.cn/info/995'

def norm(s):
    return unicodedata.normalize('NFKC', s).strip()

class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts=[]
    def handle_data(self, text):
        self.parts.append(text)
    def handle_starttag(self, tag, attrs):
        if tag in ['p','br']: self.parts.append('\n')

def plain(s):
    p=Text();p.feed(s);return norm(''.join(p.parts))

class Tables(HTMLParser):
    def __init__(self):
        super().__init__();self.rows=[];self.row=None;self.cell=None
    def handle_starttag(self,tag,attrs):
        if tag=='tr':self.row=[]
        if tag in ['td','th']:self.cell=[]
    def handle_data(self,text):
        if self.cell is not None:self.cell.append(text)
    def handle_endtag(self,tag):
        if tag in ['td','th'] and self.cell is not None:
            if self.row is not None:self.row.append(norm(''.join(self.cell)))
            self.cell=None
        if tag=='tr' and self.row is not None:self.rows.append(self.row);self.row=None

def category(name):
    if re.search('寺|庙|塔|祠|墓|石刻|城墙|王府|桥阁',name): return None
    if re.search('衙|县署|府署|提督府',name): return '官府'
    if re.search('桥$|桥群$',name):return '桥梁'
    if re.search('民居|民宅|宅|大院|大屋|庄园|土楼|围屋|光禄第',name):return '民居'
    return None

def region(location):
    match=re.match(r'^(.+?(?:省|自治区|市))',location)
    return match.group(1) if match else location

def periods(label):
    return [p for p in ['唐','宋','辽','金','元','明','清'] if p in label]

records=[];excluded=[]
def add_catalog(name,age,location,code,url,batch):
    kind=category(name)
    if not kind: return
    if re.search('民国|近代|中华人民共和国',age):
        excluded.append({'name':name,'reason':'名录年代跨越1911年，尚未逐项核实早期部分','source':url});return
    form=None
    if '廊桥' in name or '风雨桥' in name:form='廊桥（名称明确）'
    if '石拱桥' in name:form='石拱桥（名称明确）'
    if '土楼' in name:form='土楼（名称明确）'
    if '围屋' in name:form='围屋（名称明确）'
    records.append({'id':f'n{batch}-{code}','name':name,'kind':kind,'location':location,'region':region(location),'period':age,'periods':periods(age),'dateBasis':'文保名录时代；不等同于始建或现存遗构年份','code':code,'scope':'文保单位（可能含多座建筑）','source':url,'sourceName':f'第{batch}批全国重点文物保护单位名单','sourceStatus':'名录字段核对','roof':None,'material':None,'structure':None,'form':form,'bays':None,'depth':None,'area':None,'height':None,'events':[],'summary':f'{name}，名录所载时代为{age}，所在地为{location}。首版收录名录信息，构造与尺度资料仍待补充。','gaps':['承重结构','材料','屋顶或桥型','尺度','具体建造与重建事件']})

# Sixth batch: original whitespace-separated document with occasional continuation lines.
s=norm((ROOT/'research/national-heritage-6.txt').read_text(encoding='utf-8'))
s=s[s.index('三、古建筑'):];s=s[:s.index('四、')]
blocks=re.findall(r'(?m)^\d+\s+III-\d+.*?(?=^\d+\s+III-\d+|\Z)',s,re.S)
for block in blocks:
    fields=block.split()
    if len(fields)>=5:
        add_catalog(fields[2],fields[3],''.join(fields[4:]),fields[1],SRC6,6)

p=Tables();p.feed((ROOT/'research/national-heritage-8.html').read_text(encoding='utf-8'))
for row in p.rows:
    if len(row)==5 and re.fullmatch(r'8-\d{4}-3-\d{3}',row[1]):
        add_catalog(row[2],row[3],row[4],row[1],SRC8,8)

# Fifth batch: only complete records reproduced in the university's government-list archive.
s=norm((ROOT/'research/national-heritage-5.txt').read_text(encoding='utf-8'))
s=s[s.index('(三)古建筑'):];s=s[:s.index('(四)')]
for match in re.finditer(r'(?m)^(\d+)\s*\n(\d+)\s*\n(.*?)(?=\n\d+\s*\n\d+\s*\n|\Z)',s,re.S):
    fields=match.group(3).split()
    if len(fields)==3:
        add_catalog(fields[0],fields[1],fields[2],f'III-{match.group(2)}',SRC5,5)

# Curated palace components: no gardens, temples, towers, or known modern reconstructions.
PALACES='太和殿 中和殿 保和殿 乾清宫 交泰殿 太和门 午门 东华门 西华门 神武门 文华殿 武英殿 乾清门 内阁大堂 内阁大库 銮驾库 寿康宫 寿安宫 慈宁宫 长春宫 永寿宫 翊坤宫 咸福宫 钟粹宫 景阳宫 景仁宫 承乾宫 永和宫 储秀宫 太极殿 养心殿 毓庆宫 斋宫 重华宫 乐寿堂 皇极殿 宁寿宫 养性殿 同道堂 体元殿 体和殿 文渊阁 符望阁 畅音阁 漱芳斋 昭仁殿 弘德殿 丽景轩 颐和轩'.split()
guide=json.loads((ROOT/'research/palace-guide.json').read_text(encoding='utf-8'))
for source in guide['positionList']:
    name=source['name']
    if name not in PALACES:continue
    text=plain(source['detail']);opening=text.split('\n')[0]
    # Use explicitly described construction in individual sentences, not other buildings in the narrative.
    sentences=re.split(r'[。\n]',text)
    own=[t for t in sentences if name in t and re.search('面阔|屋顶|歇山|庑殿|攒尖|进深',t)]
    shape='。'.join(own[:2])
    # Some descriptions continue into the next sentence after identifying the subject.
    for i,line in enumerate(text.split('\n')):
        if name in line and re.search('面阔|平面|黄琉璃|歇山|庑殿|攒尖',line):
            shape=line.split('。')[0:3];shape='。'.join(shape);break
    roofmatch=re.search(r'(重檐|单檐)?(?:四角)?(庑殿|歇山|攒尖|悬山|硬山)(?:式)?(?:顶)?',shape)
    roof=roofmatch.group(2)+'顶' if roofmatch else None
    eaves=roofmatch.group(1) if roofmatch else None
    baysmatch=re.search(r'面阔(?:连廊)?\s*(\d+)间',shape)
    depthmatch=re.search(r'进深\s*(\d+)间',shape)
    if '面阔、进深各为3间' in shape or '深、广各3间' in shape:bays=3;depth=3
    else:bays=int(baysmatch.group(1)) if baysmatch else None;depth=int(depthmatch.group(1)) if depthmatch else None
    areamatch=re.search(r'建筑面积\s*([\d.]+)\s*(?:㎡|平方米|m2)',shape)
    area=float(areamatch.group(1)) if areamatch else None
    # Reviewed against the primary object's description; do not use an annex's roof.
    reviewed={
        '午门':{'roof':'庑殿顶','eaves':'重檐','bays':9,'depth':5},
        '西华门':{'bays':5,'depth':3},
        '东华门':{'roof':'庑殿顶','eaves':'重檐','bays':5,'depth':3},
        '神武门':{'roof':'庑殿顶','eaves':'重檐','bays':5,'depth':1},
        '文华殿':{'roof':'歇山顶','bays':5,'depth':3},
        '銮驾库':{'roof':'硬山顶','bays':None,'depth':None},
        '弘德殿':{'roof':'歇山顶','eaves':'单檐','bays':3},
        '翊坤宫':{'roof':'歇山顶','bays':5},
        '养心殿':{'roof':'歇山顶','bays':3,'depth':3},
        '养性殿':{'roof':'歇山顶','bays':3,'depth':4},
        '景阳宫':{'roof':'庑殿顶','bays':3},
        '畅音阁':{'roof':'歇山顶','eaves':'三重檐','bays':3,'depth':3},
    }.get(name,{})
    roof=reviewed.get('roof',roof);eaves=reviewed.get('eaves',eaves)
    bays=reviewed.get('bays',bays);depth=reviewed.get('depth',depth)
    events=[]
    # Exact event records reviewed against official descriptions. Ambiguous years are not inferred.
    curated={
        '乾清宫':[(1420,'始建'),(1798,'现存建筑重建')],
        '交泰殿':[(1797,'重建')],
        '武英殿':[(1869,'重建')],
        '文渊阁':[(1776,'建成')],
        '太和殿':[(1420,'建成'),(1695,'重建工程起点'),(1697,'重建竣工')],
        '太和门':[(1420,'建成'),(1889,'重建')],
    }
    events=[{'year':y,'type':t} for y,t in curated.get(name,[])]
    age='清' if name in ['銮驾库','颐和轩','斋宫','毓庆宫'] else '明清' if name=='重华宫' else '明清' if '明' in opening and '清' in text else '清' if '清' in opening else '明' if '明' in opening else '时期待核实'
    gaps=['完整尺度','承重结构','主要材料']
    if not roof:gaps.append('屋顶形制')
    if not events:gaps.append('具体建造与重建事件')
    material='琉璃瓦（屋面）' if '琉璃瓦' in shape else None
    if name in ['东华门','西华门','神武门','文华殿','銮驾库','弘德殿','翊坤宫','养心殿','养性殿','景阳宫','畅音阁']:
        material='琉璃瓦（屋面）'
    structure='减柱造' if name in ['保和殿','乾清宫'] and '减柱造' in text else None
    if structure:gaps.remove('承重结构');gaps.append('完整承重体系')
    form='殿' if name.endswith('殿') else '宫门' if name.endswith('门') else '阁' if name.endswith('阁') else '宫' if name.endswith('宫') else '堂' if name.endswith('堂') else None
    records.append({'id':f'p-{source["id"]}','name':name,'kind':'皇宫','location':'北京市 · 故宫博物院','region':'北京市','period':age,'periods':periods(age),'dateBasis':'官方解说历史沿革涉及时期；非统一现存年代','code':None,'scope':'宫城内建筑单体／局部组群','source':(source['link_detail']+'.html' if source['link_detail'] else GUIDE),'sourceName':'故宫博物院建筑解说','auxSource':GUIDE,'sourceStatus':'官方解说字段核对','roof':roof,'eaves':eaves,'material':material,'structure':structure,'form':form,'bays':bays,'depth':depth,'area':area,'height':None,'events':events,'summary':f'{name}是故宫宫城内的建筑对象。'+(f'官方描述的屋顶为{eaves or ""}{roof}。' if roof else '')+(f'记载面阔{bays}间。' if bays else '')+'具体建造与重建事件分别列示，不将始建年代替代现存形制年代。','gaps':gaps,'imageUrl':source['largeImage'],'imageCaption':f'{name} · 故宫博物院官方解说配图，具体视角见来源','imageLicense':'官网图片未确认开放再用许可；首版仅提供来源链接，不复制图片'})
    if name=='畅音阁':
        records[-1]['roofDetail']='卷棚歇山式顶，三重檐'
        records[-1]['summary']='畅音阁为清宫内廷戏楼，官方记载为三重檐、卷棚歇山式顶，面阔与进深各3间。屋顶统计按歇山类归组，细部保留卷棚表述。'
    records[-1]['fieldBasis']='宫门尺寸为城楼／门楼；宫殿尺寸为主体正殿，不能代表院落或整座宫城。'

# A separate bridge object replaces the historical alias Xian'an Palace, avoiding duplicate sites.
bridge=next(r for r in guide['positionList'] if r['name']=='断虹桥')
records.append({'id':f'p-{bridge["id"]}','name':'断虹桥','kind':'桥梁','location':'北京市 · 故宫博物院','region':'北京市','period':'元或明初（有争议）','periods':['元','明'],'dateBasis':'官方记载为元代或明初，尚无定论；不编码为精确年份或连续年代跨度','code':None,'scope':'桥梁单体','source':bridge['link_detail']+'.html','sourceName':'故宫博物院建筑解说','auxSource':GUIDE,'sourceStatus':'官方解说字段核对，年代保留争议','roof':None,'eaves':None,'material':None,'surfaceMaterial':'汉白玉（桥面）','structure':'单拱石券','form':'石拱桥','bays':None,'depth':None,'area':None,'height':None,'length':18.7,'width':9.2,'widthQualifier':'最宽处','events':[],'summary':'断虹桥为单拱石券桥，桥面铺汉白玉石。官方记载长18.7米，最宽处9.20米。建造年代为元代或明初，尚未定论。','gaps':['具体建造年代','净跨度','完整测绘资料'],'imageUrl':bridge['largeImage'],'imageCaption':'断虹桥 · 故宫博物院官方解说配图，具体视角见来源','imageLicense':'未核实再用许可，仅链接原图'})
excluded.append({'name':'咸安宫（原址）','reason':'原址后改名寿安宫，与已收录对象历史名称重叠，未作为独立建筑重复计数','source':GUIDE})

# The government record names explicitly identify a few forms. These are not inferred geometry.
seen=set();unique=[]
for record in records:
    if record['name'] in seen:continue
    seen.add(record['name']);unique.append(record)
records=unique
out={'meta':{'title':'构·谱——中国古代建筑基因图谱','updated':'2026-10-07','version':'1.0','scope':'非总体抽样：文保名录单位与故宫局部建筑分别收录；计数为收录对象数，不是全国建筑总数','chronology':'名录时代与官方历史沿革时期分别标注。建造与重建事件在建筑详情列示，不以朝代边界替代建筑年份。','aiNote':'参考2026通知，正式参赛需核对届次主题与AI工具限制。Codex不在该通知列出的非音乐类AI工具名单内。','sources':[{'title':'第六批全国重点文物保护单位名单','url':SRC6,'authority':'文化和旅游部转载国务院通知'},{'title':'第八批全国重点文物保护单位名单','url':SRC8,'authority':'国家林业和草原局转载国务院通知'},{'title':'第五批全国重点文物保护单位名单','url':SRC5,'authority':'北京建筑大学建筑遗产研究院存档，辅助转载来源'},{'title':'故宫博物院建筑解说','url':'https://www.dpm.org.cn/explore/buildings.html','authority':'故宫博物院；字段取自官方青少版解说接口'}]},'buildings':records,'excluded':excluded}
(ROOT/'site/dist/data.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
# Classic script permits direct file opening without a local HTTP server.
(ROOT/'site/dist/data.js').write_text('window.ATLAS_DATA = '+json.dumps(out,ensure_ascii=False)+';\n',encoding='utf-8')
print('COUNT',len(records),dict(Counter(r['kind'] for r in records)))
print('ROOFS',dict(Counter(r['roof'] for r in records)))
print('SCALES',len([r for r in records if r['bays'] and r['depth']]))
print('EXCLUDED',len(excluded))
