"""Mirror https://www.easyoffice.cl/ into ./site for local development.

Usage:  python tools/mirror.py [extra_url ...]
Serve:  python -m http.server 8080 -d site
"""
import os, re, sys, gzip, zlib, urllib.request, urllib.parse
from collections import deque
from concurrent.futures import ThreadPoolExecutor

HOST = "www.easyoffice.cl"
BASE = f"https://{HOST}/"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"

SEEDS = [
    "", "firmas-electronicas/", "domicilio-tributario/", "rebaja-tributaria/",
    "contabilidad/", "asesoriaempresas/",
    "viverra-metus-parturient-par/", "cum-fames-a-cras-dictumst/",
    "non-vestibulum-lacus-sociosqu-hac/", "leo-placerat-ac-a-dis/",
    "condentum-integer-ridiculus/", "sed-ultrices-netus/",
    "category/fashion/", "category/lifestyle/", "category/travel/", "category/uncategorized/",
]

# Absolute URLs to our host, plain or JSON-escaped (https:\/\/www.easyoffice.cl\/...)
ABS_RE = re.compile(r'(?:https?:)?\\?/\\?/(?:www\.)?easyoffice\.cl((?:\\?/[^\s"\'<>()\\,]*)*)', re.I)
ROOTREL_RE = re.compile(r'''(?<=["'(=\s])(/wp-(?:content|includes)/[^\s"'<>()]+)''')
CSS_URL_RE = re.compile(r'''url\(\s*['"]?([^'")]+?)['"]?\s*\)|@import\s+['"]([^'"]+)['"]''')
PAGE_EXCLUDE = re.compile(r"/(wp-admin|wp-json|feed|xmlrpc|wp-login|comments|author|tag)(/|\.|$)|\?|#|\.xml$")
ASSET_EXT = re.compile(r"\.(css|js|mjs|png|jpe?g|gif|webp|svg|ico|avif|woff2?|ttf|eot|otf|mp4|webm|json|map|pdf)$", re.I)

# Never crawl the admin/API/backend endpoints.
SKIP_RE = re.compile(r"/(wp-admin|wp-json|xmlrpc\.php|wp-login\.php|wp-cron\.php|feed|comments|navigation)(/|$|\?)")

seen, saved, failed = set(), [], []


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip, deflate"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
        enc = r.headers.get("Content-Encoding", "")
        if enc == "gzip":
            data = gzip.decompress(data)
        elif enc == "deflate":
            data = zlib.decompress(data)
        return data, r.headers.get("Content-Type", "")


def local_path(url):
    p = urllib.parse.urlparse(url).path or "/"
    p = urllib.parse.unquote(p)
    if p.endswith("/"):
        p += "index.html"
    elif not os.path.splitext(p)[1]:
        p += "/index.html"
    return os.path.normpath(os.path.join(ROOT, p.lstrip("/")))


def rewrite(text):
    # Absolute site URLs -> root-relative, keeping JSON escaping intact.
    def sub(m):
        path = m.group(1) or "/"
        return path if path else "/"
    return ABS_RE.sub(sub, text)


def normalize(raw, base):
    raw = raw.replace("\\/", "/").strip().replace("&amp;", "&").replace("&#038;", "&")
    if raw.startswith(("data:", "#", "javascript:", "mailto:", "tel:")) or not raw:
        return None
    u = urllib.parse.urljoin(base, raw)
    pu = urllib.parse.urlparse(u)
    if pu.netloc.lower() not in (HOST, "easyoffice.cl"):
        return None
    return urllib.parse.urlunparse(("https", HOST, pu.path, "", pu.query, ""))


def discover(text, base, is_css):
    found = set()
    for m in ABS_RE.finditer(text):
        found.add(normalize("https://" + HOST + (m.group(1) or "/"), base))
    for m in ROOTREL_RE.finditer(text):
        found.add(normalize(m.group(1), base))
    if is_css:
        for m in CSS_URL_RE.finditer(text):
            found.add(normalize(m.group(1) or m.group(2), base))
    return {f for f in found if f}


def is_page(url):
    path = urllib.parse.urlparse(url).path
    return not ASSET_EXT.search(path) and not PAGE_EXCLUDE.search(url) and not path.startswith(("/wp-content", "/wp-includes"))


def process(url):
    try:
        data, ctype = fetch(url)
    except Exception as e:
        failed.append((url, str(e)))
        return set()
    dest = local_path(url)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    textual = any(t in ctype for t in ("text/", "javascript", "json", "svg", "xml")) or dest.endswith((".css", ".js", ".html", ".json", ".svg"))
    found = set()
    if textual:
        text = data.decode("utf-8", errors="replace")
        found = discover(text, url, dest.endswith(".css") or "text/css" in ctype)
        if dest.endswith(".js"):
            # JS only contributes absolute asset URLs, never new pages.
            found = {f for f in found if not is_page(f)}
        data = rewrite(text).encode("utf-8")
    with open(dest, "wb") as f:
        f.write(data)
    saved.append(url)
    return found


def main():
    queue = deque(urllib.parse.urljoin(BASE, s) for s in SEEDS + sys.argv[1:])
    seen.update(queue)
    with ThreadPoolExecutor(max_workers=8) as pool:
        while queue:
            batch = [queue.popleft() for _ in range(len(queue))]
            for found in pool.map(process, batch):
                for u in found:
                    # Strip query strings from assets (?ver=...) – served statically.
                    key = u.split("?")[0] if not is_page(u) else u
                    if key in seen or SKIP_RE.search(key):
                        continue
                    seen.add(key)
                    queue.append(key)
            print(f"saved {len(saved)}  queued {len(queue)}  failed {len(failed)}", flush=True)
    for u, e in failed:
        print("FAILED", u, e)


if __name__ == "__main__":
    main()
