from collect_sources import fetch, ROOT
import pymupdf

URLS = {
    'palace-guide.json': 'https://young.dpm.org.cn/info/995',
    'national-heritage-5.html': 'https://aah.bucea.edu.cn/zlxz/zyzl/123724.htm',
    'national-heritage-7-text.pdf': 'https://nrp.jinan.gov.cn/attach/0/3df13bf4d8ab49e08d4003e412e02829.pdf',
    'national-heritage-8.html': 'https://www.forestry.gov.cn/main/4815/20191016/173000319923859.html',
    'palace-list.html': 'https://www.dpm.org.cn/searchs/buildings.html?category_id=73&pagesize=200',
}
for name, url in URLS.items():
    try:
        body = fetch(url, ROOT / 'research' / name)
        if name.endswith('.pdf'):
            doc = pymupdf.open(stream=body, filetype='pdf')
            text = '\n'.join(p.get_text(sort=True) for p in doc)
            (ROOT / 'research' / name.replace('.pdf', '.txt')).write_text(text, encoding='utf-8')
            print(name, len(text), text[:500])
        else:
            print(name, len(body), body[:100])
    except Exception as error:
        print(name, type(error).__name__, str(error)[:200])
