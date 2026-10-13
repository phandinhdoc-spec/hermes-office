"""Tests for the web helpers. No test touches the real Internet: servers are local, HTTP calls are patched."""
import base64
import http.server
import socket
import struct
import threading
import zlib

import pytest

import office_web as w


# ----------------------------------------------------------------------------- helpers


def png(width, height):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\xff\x00\x00" * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def jpeg(width, height):
    return (b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
            b"\xff\xc0\x00\x11\x08" + struct.pack(">HH", height, width) + b"\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01\xff\xd9")


class Server:
    """Tiny local web server: routes maps path -> (status, headers, body) or a callable(handler)."""

    def __init__(self, routes):
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                outer.hits.append(self.path)
                r = routes.get(self.path.split("?")[0])
                if r is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                status, headers, body = r
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", headers.get("X-Fake-Length", str(len(body))))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body[: 1024 * 1024 * 20])

            def log_message(self, *a):
                pass

        self.hits = []
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def close(self):
        self.httpd.shutdown()


@pytest.fixture
def allow_private(monkeypatch):
    monkeypatch.setenv("HERMES_OFFICE_WEB_ALLOW_PRIVATE", "1")


# ----------------------------------------------------------------------------- address guard


@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "ftp://example.com/a", "javascript:alert(1)", "gopher://example.com",
    "http://localhost/", "http://LOCALHOST./", "http://foo.localhost/", "http://printer.local/", "http://db.internal/",
    "http://127.0.0.1/", "http://127.1/", "http://0.0.0.0/", "http://[::1]/", "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/", "http://172.16.3.4/", "http://192.168.1.1/",
    "http://100.64.0.1/", "http://224.0.0.1/", "http://[fe80::1]/", "http://[fd00::1]/",
    "https://user:pw@example.com/", "https://example.com:8443/", "http://example.com:22/", "", "   ", "http:///x",
])
def test_blocked_urls(url, monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))])  # a public answer
    monkeypatch.setattr(w, "_proxy_applies", lambda u: False)
    with pytest.raises(w.WebError):
        w.check_url(url)


def test_public_hosts_pass(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))])
    assert w.check_url("https://example.com/a?b=1") == "https://example.com/a?b=1"
    assert w.check_url("http://example.com:80/x")
    assert w.check_url("https://8.8.8.8/")


@pytest.mark.parametrize("answer", ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "192.168.0.9", "100.100.100.100"])
def test_hostname_resolving_to_private_is_blocked(answer, monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", (answer, 0))])
    with pytest.raises(w.WebError):
        w.check_url("https://evil.example.com/")


def test_any_private_address_in_the_answer_blocks(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0)), (2, 1, 6, "", ("10.0.0.1", 0))])
    with pytest.raises(w.WebError):
        w.check_url("https://rebind.example.com/")


def test_decimal_and_hex_host_forms_are_blocked(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("127.0.0.1", 0))])  # what libc answers for them
    monkeypatch.setattr(w, "_proxy_applies", lambda u: False)
    for u in ("http://2130706433/", "http://0x7f000001/", "http://017700000001/"):
        with pytest.raises(w.WebError):
            w.check_url(u)


def test_dns_failure_is_refused_without_proxy_but_allowed_with_proxy(monkeypatch):
    def boom(*a, **k):
        raise socket.gaierror("no dns")

    monkeypatch.setattr(socket, "getaddrinfo", boom)
    monkeypatch.setattr(w, "_proxy_applies", lambda u: False)
    with pytest.raises(w.WebError):
        w.check_url("https://example.com/")
    monkeypatch.setattr(w, "_proxy_applies", lambda u: True)
    assert w.check_url("https://example.com/")
    with pytest.raises(w.WebError):  # a proxy never makes loopback acceptable
        w.check_url("http://127.0.0.1/")


def test_redirect_to_private_address_is_blocked(monkeypatch):
    srv = Server({"/start": (302, {"Location": "http://10.0.0.7/secret"}, b""), "/loop": (302, {"Location": "/loop"}, b"")})
    try:
        real = w.check_url
        monkeypatch.setattr(w, "check_url", lambda u: u if u.startswith(srv.url("")) else real(u))
        with pytest.raises(w.WebError, match="nội bộ|riêng tư"):
            w.http_get(srv.url("/start"), max_bytes=1000)
        with pytest.raises(w.WebError, match="chuyển hướng"):
            w.http_get(srv.url("/loop"), max_bytes=1000)
    finally:
        srv.close()


# ----------------------------------------------------------------------------- query hygiene


@pytest.mark.parametrize("q", ["", "   ", None, 5, "dòng 1\ndòng 2", "x" * 121])
def test_bad_queries_are_refused(q):
    with pytest.raises(w.WebError):
        w.clean_query(q)


def test_good_query_is_normalised():
    assert w.clean_query("  lịch sử   Coca-Cola ") == "lịch sử Coca-Cola"
    assert len(w.clean_query("x" * 120)) == 120


def test_search_tool_never_sends_a_long_text(monkeypatch):
    called = []
    monkeypatch.setattr(w, "http_get", lambda *a, **k: called.append(a) or (b"", "", ""))
    with pytest.raises(w.WebError):
        w.web_search({"query": "Đoạn văn bản dài của người dùng. " * 20})
    assert not called


# ----------------------------------------------------------------------------- image bytes


def test_image_info_png_jpeg_gif_webp():
    assert w.image_info(png(30, 20)) == ("image/png", 30, 20)
    assert w.image_info(jpeg(640, 480)) == ("image/jpeg", 640, 480)
    assert w.image_info(b"GIF89a" + struct.pack("<HH", 7, 9) + b"\x00" * 10) == ("image/gif", 7, 9)
    vp8x = b"RIFF" + b"\x00" * 4 + b"WEBP" + b"VP8X" + b"\x0a\x00\x00\x00" + b"\x00" * 4 + (1599).to_bytes(3, "little") + (899).to_bytes(3, "little")
    assert w.image_info(vp8x) == ("image/webp", 1600, 900)


@pytest.mark.parametrize("data", [b"", b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"<html>hi</html>", b"%PDF-1.4", b"\xff\xd8\xff"])
def test_not_an_image(data):
    with pytest.raises(w.WebError):
        w.image_info(data)


# ----------------------------------------------------------------------------- fetch_image


def test_fetch_image_stores_picture_and_returns_only_metadata(allow_private):
    data = png(40, 30)
    srv = Server({"/a.png": (200, {"Content-Type": "text/html"}, data)})  # a lying Content-Type must not matter
    try:
        res = w.fetch_image({"url": srv.url("/a.png"), "title": "Chai Coca", "author": "An", "license": "CC BY 4.0", "source": "Wikimedia Commons"})
    finally:
        srv.close()
    assert res["ok"] and res["mime"] == "image/png" and (res["width"], res["height"]) == (40, 30)
    assert "base64" not in res and res["imageId"].startswith("img_")
    assert "CC BY 4.0" in res["credit"] and "Chai Coca" in res["credit"]
    injected = w.inject_image({"imageId": res["imageId"], "slideIndex": 2})
    assert base64.b64decode(injected["base64"]) == data
    assert injected["imageWidth"] == 40 and "imageId" not in injected and injected["slideIndex"] == 2


def test_fetch_image_rejects_svg_html_and_oversize(allow_private):
    srv = Server({
        "/x.svg": (200, {"Content-Type": "image/svg+xml"}, b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
        "/p.png": (200, {"Content-Type": "image/png"}, b"<html>login</html>"),
        "/big.png": (200, {"Content-Type": "image/png", "X-Fake-Length": str(w.IMAGE_MAX_BYTES + 1)}, b"x"),
    })
    try:
        for path in ("/x.svg", "/p.png", "/big.png"):
            with pytest.raises(w.WebError):
                w.fetch_image({"url": srv.url(path)})
    finally:
        srv.close()


def test_fetch_image_stops_reading_a_body_that_lies_about_its_size(allow_private, monkeypatch):
    monkeypatch.setattr(w, "IMAGE_MAX_BYTES", 5000)
    srv = Server({"/l.png": (200, {"Content-Type": "image/png"}, png(200, 200) + b"\x00" * 20000)})
    try:
        with pytest.raises(w.WebError, match="quá lớn"):
            w.fetch_image({"url": srv.url("/l.png")})
    finally:
        srv.close()


def test_fetch_image_uses_fallback_when_first_fails(allow_private):
    srv = Server({"/small.jpg": (200, {}, jpeg(800, 450))})
    try:
        res = w.fetch_image({"url": srv.url("/missing.jpg"), "fallbackUrl": srv.url("/small.jpg")})
    finally:
        srv.close()
    assert (res["width"], res["height"], res["mime"]) == (800, 450, "image/jpeg")


def test_fetch_image_refuses_private_hosts_by_default():
    for u in ("http://127.0.0.1:9/a.png", "http://169.254.169.254/x.png", "file:///etc/hosts"):
        with pytest.raises(w.WebError):
            w.fetch_image({"url": u})


def test_inject_image_unknown_id_and_passthrough():
    with pytest.raises(w.WebError, match="không tìm thấy"):
        w.inject_image({"imageId": "img_nope"})
    args = {"slideIndex": 1}
    assert w.inject_image(args) is args


def test_image_cache_drops_oldest():
    c = w.ImageCache(max_items=2)
    ids = [c.put({"base64": "a" * 10}) for _ in range(3)]
    assert c.get(ids[0]) is None and c.get(ids[1]) and c.get(ids[2])
    c2 = w.ImageCache(max_items=10, max_bytes=25)
    a, b, d = (c2.put({"base64": "x" * 10}) for _ in range(3))
    assert c2.get(a) is None and c2.get(d)


# ----------------------------------------------------------------------------- searches (HTTP patched)

DDG = '''
<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvi.wikipedia.org%2Fwiki%2FCoca-Cola&amp;rut=abc">Coca-Cola &ndash; Wikipedia</a></h2>
<a class="result__snippet" href="x">Coca-Cola là thương hiệu <b>nước ngọt</b> ra đời năm 1886.</a></div>
<div class="result"><a class="result__a" href="//duckduckgo.com/y.js?ad_provider=bing">Quảng cáo</a></div>
<div class="result"><a rel="nofollow" class="result__a" href="https://www.coca-colacompany.com/about-us">About us</a>
<a class="result__snippet">The Coca-Cola Company history.</a></div>
'''


def test_parse_duckduckgo():
    r = w.parse_duckduckgo(DDG, 5)
    assert [x["url"] for x in r] == ["https://vi.wikipedia.org/wiki/Coca-Cola", "https://www.coca-colacompany.com/about-us"]
    assert r[0]["title"] == "Coca-Cola – Wikipedia" and "nước ngọt" in r[0]["snippet"] and "<b>" not in r[0]["snippet"]
    assert len(w.parse_duckduckgo(DDG, 1)) == 1


def fake_get(table):
    def get(url, **kw):
        for key, body in table.items():
            if key in url:
                return (body if isinstance(body, bytes) else body.encode()), "text/html", url
        raise w.WebError("không có trong bảng giả: " + url)

    return get


WIKI = '{"query":{"pages":{"2":{"index":2,"title":"B","fullurl":"https://vi.wikipedia.org/wiki/B","extract":"Bb"},"1":{"index":1,"title":"A","fullurl":"https://vi.wikipedia.org/wiki/A","extract":"Aa"}}}}'
COMMONS = ('{"query":{"pages":{"9":{"index":1,"title":"File:Coca-Cola bottle.jpg","imageinfo":[{"thumburl":"https://upload.wikimedia.org/t/1600px-a.jpg","url":"https://upload.wikimedia.org/a.jpg",'
           '"descriptionurl":"https://commons.wikimedia.org/wiki/File:a.jpg","mime":"image/jpeg","thumbwidth":1600,"thumbheight":1067,'
           '"extmetadata":{"LicenseShortName":{"value":"CC BY-SA 4.0"},"Artist":{"value":"<a href=\\"x\\">Nguyễn An</a>"}}}]},'
           '"8":{"index":2,"title":"File:Logo.svg","imageinfo":[{"url":"https://upload.wikimedia.org/l.svg","mime":"image/svg+xml"}]}}}}')
OPENVERSE = ('{"results":[{"title":"Chai nước","url":"https://live.staticflickr.com/1.jpg","thumbnail":"https://api.openverse.org/v1/images/1/thumb/","creator":"Bình",'
             '"license":"by","license_version":"2.0","license_url":"https://creativecommons.org/licenses/by/2.0/","foreign_landing_url":"https://flickr.com/p/1","source":"flickr","width":1024,"height":768}]}')


def test_wikipedia_results_are_ordered(monkeypatch):
    monkeypatch.setattr(w, "http_get", fake_get({"wikipedia.org/w/api.php": WIKI}))
    r = w.search_wikipedia("x", "vi", 5)
    assert [p["title"] for p in r] == ["A", "B"] and r[0]["source"] == "Wikipedia (vi)"


def test_commons_skips_svg_and_cleans_author(monkeypatch):
    monkeypatch.setattr(w, "http_get", fake_get({"commons.wikimedia.org": COMMONS}))
    r = w.search_commons("coca", 5)
    assert len(r) == 1 and r[0]["license"] == "CC BY-SA 4.0" and r[0]["author"] == "Nguyễn An" and r[0]["title"] == "Coca-Cola bottle"
    assert r[0]["imageUrl"].endswith("1600px-a.jpg") and r[0]["source"] == "Wikimedia Commons"


def test_image_search_merges_sources_and_survives_one_failing(monkeypatch):
    monkeypatch.delenv("PEXELS_API_KEY", raising=False)
    monkeypatch.delenv("UNSPLASH_ACCESS_KEY", raising=False)
    monkeypatch.setattr(w, "http_get", fake_get({"commons.wikimedia.org": COMMONS, "api.openverse.org": OPENVERSE}))
    res = w.web_search({"query": "coca cola", "kind": "image", "limit": 4})
    assert [x["source"] for x in res["results"]] == ["Wikimedia Commons", "Openverse/flickr"]
    assert res["results"][1]["license"] == "CC BY 2.0" and res["untrusted"] and not res["failedSources"]
    monkeypatch.setattr(w, "http_get", fake_get({"api.openverse.org": OPENVERSE}))  # Commons now fails
    res = w.web_search({"query": "coca cola", "kind": "image"})
    assert len(res["results"]) == 1 and res["failedSources"] and "Wikimedia" in res["failedSources"][0]
    monkeypatch.setattr(w, "http_get", fake_get({}))
    with pytest.raises(w.WebError, match="không tìm được ảnh"):
        w.web_search({"query": "coca cola", "kind": "image"})


def test_pexels_key_makes_it_the_first_source(monkeypatch):
    monkeypatch.setenv("PEXELS_API_KEY", "k")
    seen = {}

    def get(url, **kw):
        seen.setdefault("headers", kw.get("headers"))
        if "pexels" in url:
            return b'{"photos":[{"alt":"chai","src":{"large2x":"https://images.pexels.com/1.jpeg"},"url":"https://pexels.com/p/1","photographer":"Lan","width":4000,"height":3000}]}', "", url
        raise w.WebError("x")

    monkeypatch.setattr(w, "http_get", get)
    res = w.web_search({"query": "chai", "kind": "image"})
    assert res["results"][0]["source"] == "Pexels" and seen["headers"] == {"Authorization": "k"}


def test_web_search_falls_back_to_wikipedia(monkeypatch):
    monkeypatch.setattr(w, "http_get", fake_get({"wikipedia.org/w/api.php": WIKI}))  # DuckDuckGo missing -> WebError
    res = w.web_search({"query": "A", "kind": "web", "lang": "vi"})
    assert res["results"][0]["source"].startswith("Wikipedia") and "Wikipedia thay thế" in res["note"]
    monkeypatch.setattr(w, "http_get", fake_get({"html.duckduckgo.com": DDG}))
    res = w.web_search({"query": "coca", "kind": "web"})
    assert res["results"][0]["source"] == "DuckDuckGo" and "note" not in res


def test_unknown_kind():
    with pytest.raises(w.WebError):
        w.web_search({"query": "a", "kind": "video"})


# ----------------------------------------------------------------------------- fetch_text


def test_fetch_text_strips_scripts_and_caps(allow_private):
    page = ("<html><head><title>Giới thiệu</title><script>steal()</script></head><body><nav>menu</nav><p>Xin chào thế giới.</p><style>p{}</style><p>" + "a" * 800 + "</p></body></html>").encode("utf-8")
    srv = Server({"/p": (200, {"Content-Type": "text/html; charset=utf-8"}, page), "/bin": (200, {"Content-Type": "application/zip"}, b"PK")})
    try:
        res = w.fetch_text({"url": srv.url("/p"), "maxChars": 500})
        assert res["title"] == "Giới thiệu" and "Xin chào thế giới." in res["text"] and "steal" not in res["text"] and "menu" not in res["text"]
        assert len(res["text"]) <= 500 and res["truncated"] and res["untrusted"]
        with pytest.raises(w.WebError):
            w.fetch_text({"url": srv.url("/bin")})
    finally:
        srv.close()


def test_run_web_tool_adds_timing(monkeypatch):
    monkeypatch.setattr(w, "web_search", lambda a: {"ok": True})
    monkeypatch.setitem(w._HANDLERS, "office_web_search", lambda a: {"ok": True})
    assert "tookMs" in w.run_web_tool("office_web_search", {})
