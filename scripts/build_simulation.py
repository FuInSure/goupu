"""Create a reproducible fictional demonstration layer, preserving the evidence dataset."""
from pathlib import Path
import hashlib, json, random
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT/'site/dist/data.json').read_text(encoding='utf-8'))
items=[]
for record in data['buildings']:
    rng=random.Random(int(hashlib.sha256(record['id'].encode()).hexdigest()[:16],16))
    values={}
    def fill(field,value):
        if record.get(field) is None:
            values[field]=value
    kind=record['kind']
    if kind=='桥梁':
        existing=record.get('form') or ''
        bridge_type='木廊桥' if '廊桥' in existing or '风雨桥' in record['name'] else '石拱桥' if '拱桥' in existing or record.get('structure')=='单拱石券' else rng.choice(['石拱桥','石拱桥','石梁桥','木梁桥'])
        fill('form',bridge_type)
        fill('structure',{'木廊桥':'木梁承重（模拟）','石拱桥':'石拱承重（模拟）','石梁桥':'石梁承重（模拟）','木梁桥':'木梁承重（模拟）'}[bridge_type])
        fill('supportMaterial','木材' if bridge_type.startswith('木') else '石材')
        fill('surfaceMaterial','木板（桥面）' if bridge_type.startswith('木') else '石板（桥面）')
        length=record.get('length') or round(rng.uniform(18,105),1)
        width=record.get('width') or round(rng.uniform(2.5,7.5),1)
        fill('length',length);fill('width',width);fill('widthQualifier','模拟桥面宽')
        fill('span',round(rng.uniform(6,min(25,length*.75)),1))
        fill('height',round(rng.uniform(2.5,8.5),1))
        fill('area',round(length*width,1))
        if 'area' in values:fill('areaBasis','模拟桥面平面面积：桥长×桥面宽；不与房屋建筑面积合并')
        # Open bridges have no roof; no house bay/depth columns are filled for a bridge.
        if bridge_type=='木廊桥':
            fill('roof',rng.choice(['悬山顶','硬山顶']));fill('material','青瓦（廊屋屋面）');fill('eaves','单檐')
    else:
        bays=record.get('bays') or rng.choice([3,3,5,5,7] if kind=='民居' else [3,5,5,7,9])
        depth=record.get('depth') or rng.choice([2,3,3,4] if kind=='民居' else [3,3,4,5])
        fill('bays',bays);fill('depth',depth)
        fill('roof',rng.choice(['硬山顶','硬山顶','悬山顶','歇山顶']) if kind=='民居' else rng.choice(['硬山顶','歇山顶','歇山顶']) if kind=='官府' else rng.choice(['歇山顶','歇山顶','硬山顶','庑殿顶']))
        fill('eaves','单檐')
        fill('form','宅院（模拟）' if kind=='民居' else '衙署（模拟）' if kind=='官府' else '宫殿（模拟）')
        fill('material','琉璃瓦（屋面）' if kind=='皇宫' else rng.choice(['青瓦（屋面）','灰瓦（屋面）']))
        fill('structure',rng.choice(['穿斗式（模拟）','抬梁式（模拟）']) if kind=='民居' else '抬梁式（模拟）')
        fill('supportMaterial','夯土与木材' if '土楼' in (record.get('form') or '') else rng.choice(['木材','木材','砖木']) if kind=='民居' else '木材')
        bay_width=rng.uniform(3.1,4.7) if kind=='民居' else rng.uniform(3.8,5.8)
        bay_depth=rng.uniform(2.8,4.3)
        fill('area',round(bays*depth*bay_width*bay_depth,1))
        if 'area' in values:fill('areaBasis','模拟代表性主体单层平面面积，不代表文保单位或整个建筑群总面积')
        fill('height',round(rng.uniform(5.0,10.8) if kind=='民居' else rng.uniform(7.0,16.0),1))
    items.append({'id':record['id'],'status':'模拟估算','method':'按主题类型设置的演示区间，用对象ID固定随机种子；未进行测绘、文献核实或统计拟合。建筑群使用代表性单体示例尺度。','values':values,'fieldStatus':{field:'模拟估算，原始字段未核实' for field in values}})

counts=Counter(field for item in items for field in item['values'])
output={'meta':{'version':'demo-1','created':'2026-10-07','status':'模拟展示数据，不是史实','notice':'模拟值仅补充界面展示。原始缺失值与资料缺口保留；所有模拟字段单独标注，不附文献来源，不参与真实性或完整程度评价。','chronology':'不生成建筑年份、始建／重建事件或来源。','seedMethod':'SHA-256(object ID), first 16 hex digits, Python Random','counts':dict(counts)},'records':items}
(ROOT/'site/dist/simulation.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
(ROOT/'site/dist/simulation.js').write_text('window.ATLAS_SIMULATION = '+json.dumps(output,ensure_ascii=False)+';\n',encoding='utf-8')
print('SIMULATED FIELDS',sum(counts.values()),dict(counts))
