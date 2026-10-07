"""Download official source documents; writes incremental, reproducible snapshots."""
from pathlib import Path
from urllib.request import Request, urlopen
import time
import pymupdf

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    7: 'https://www.gov.cn/guoqing/2014-07/21/dqpqgzdwwbhdwmd.pdf',
    8: 'https://www.gov.cn/gbgl/75e17ff291dd418f8f758d508087cd8b/files/6250670fc770465787b85d705d4b12f9.pdf',
}

def fetch(url, target):
    if target.exists():
        return target.read_bytes()
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=45) as response:
                body = response.read()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            return body
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1 + attempt)

if __name__ == '__main__':
    fetch('https://zwgk.mct.gov.cn/zfxxgkml/qt/202012/t20201206_918486.html', ROOT / 'research' / 'national-heritage-6.html')
    fetch('https://www.dpm.org.cn/explore/buildings.html', ROOT / 'research' / 'palace-index.html')
    for batch, url in SOURCES.items():
        target = ROOT / 'research' / f'national-heritage-{batch}.pdf'
        fetch(url, target)
        doc = pymupdf.open(target)
        text = '\n'.join(p.get_text(sort=True) for p in doc)
        target.with_suffix('.txt').write_text(text, encoding='utf-8')
        print(f'Batch {batch}: {len(doc)} pages')
        for i, page in enumerate(doc):
            content = page.get_text(sort=True)
            if '三、古建筑' in content or '三、 古建筑' in content:
                print(f'Page {i + 1}\n{content[:8000]}')
