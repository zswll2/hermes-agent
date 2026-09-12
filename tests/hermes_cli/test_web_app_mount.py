"""Contract tests for the /app mount (HERMES_WEB_APP_DIST browser build).

Covers the correctness points the plan calls out:
- /app is registered BEFORE mount_spa's catch-all (a later registration would be
  permanently shadowed — Starlette matches in registration order);
- loopback index injects the session token exactly once; gated index injects
  none and flags __HERMES_AUTH_REQUIRED__=true;
- the auth gate is default-deny, so /app and /app/assets/* sit behind the cookie
  session (302 → /login when gated, ws-ticket mint 401s unauthenticated);
- hashed assets carry the immutable cache header and a javascript content-type
  (content-level discrimination: a catch-all fallback would serve text/html);
- real files under the dist (emojibase data) are served as files, hash routes
  fall back to index, traversal attempts never escape the dist;
- with HERMES_WEB_APP_DIST unset, /app behaves byte-identically to any other
  unmatched path (the catch-all baseline — NOT a 404).
"""

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

INDEX_MARKER = "<!--web-app-fixture-->"
INDEX_HTML = (
    '<!doctype html><html><head>'
    '<link rel="manifest" href="./manifest.webmanifest">'
    "</head>"
    f"<body>{INDEX_MARKER}</body></html>"
)


@pytest.fixture
def web_app_dist(tmp_path):
    dist = tmp_path / "dist-web"
    (dist / "assets").mkdir(parents=True)
    (dist / "emojibase/en").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    (dist / "assets/index-test.js").write_text("console.log('web')", encoding="utf-8")
    (dist / "emojibase/en/data.json").write_text('{"emojis": []}', encoding="utf-8")
    return dist


def _fresh_mounted_app(monkeypatch, web_app_dist):
    """A fresh FastAPI app with mount_spa() applied while WEB_APP_DIST is patched.

    mount_spa must be called AFTER the patch so _mount_web_app_before_catchall
    sees the dist — exactly how import order plays out in the real process
    (web_server reads HERMES_WEB_APP_DIST at import, mount_spa(app) at :975).
    """
    import hermes_cli.web_server as web_server
    from hermes_cli.web_server_dashboard import mount_spa

    monkeypatch.setattr(web_server, "WEB_APP_DIST", web_app_dist)
    app = FastAPI()
    mount_spa(app)
    return app


def _gated(app):
    app.state.auth_required = True

    @app.middleware("http")
    async def _gate(request, call_next):
        from hermes_cli.dashboard_auth.middleware import gated_auth_middleware

        return await gated_auth_middleware(request, call_next)

    return app


class TestMountOrder:
    def test_app_reachable_not_swallowed_by_catchall(self, monkeypatch, web_app_dist):
        app = _fresh_mounted_app(monkeypatch, web_app_dist)
        client = TestClient(app)
        # Bare /app redirects to the canonical /app/ (relative asset URLs need the
        # trailing slash); following it must land on the WEB app's index, proving
        # the route beats mount_spa's catch-all.
        res = client.get("/app", follow_redirects=False)
        assert res.status_code == 307
        assert res.headers["location"] == "/app/"
        final = client.get("/app/")
        assert final.status_code == 200
        assert INDEX_MARKER in final.text
        assert "manifest.webmanifest" in final.text

    def test_unset_env_app_equals_catchall_baseline_byte_identical(self, monkeypatch, web_app_dist):
        import hermes_cli.web_server as web_server
        from hermes_cli.web_server_dashboard import mount_spa

        monkeypatch.setattr(web_server, "WEB_APP_DIST", None)
        app = FastAPI()
        mount_spa(app)
        client = TestClient(app)
        app_res = client.get("/app")
        baseline_res = client.get("/__probe_unmatched_path")
        assert app_res.status_code == baseline_res.status_code
        assert app_res.content == baseline_res.content


class TestIndexInjection:
    def test_loopback_index_injects_token_once(self, monkeypatch, web_app_dist):
        app = _fresh_mounted_app(monkeypatch, web_app_dist)
        res = TestClient(app).get("/app/")
        assert res.status_code == 200
        assert res.text.count("__HERMES_SESSION_TOKEN__") == 1
        assert "__HERMES_AUTH_REQUIRED__=false" in res.text
        assert "no-store" in res.headers["cache-control"].lower()

    def test_gated_index_has_no_token(self, monkeypatch, web_app_dist):
        app = _fresh_mounted_app(monkeypatch, web_app_dist)
        # No middleware here — the route reads application.state directly, which
        # is exactly the flag start_server flips in production.
        app.state.auth_required = True
        res = TestClient(app, follow_redirects=False).get("/app/")
        assert res.status_code == 200
        assert "__HERMES_SESSION_TOKEN__" not in res.text
        assert "__HERMES_AUTH_REQUIRED__=true" in res.text


class TestAssetsAndFiles:
    def test_hashed_asset_immutable_and_javascript(self, monkeypatch, web_app_dist):
        app = _fresh_mounted_app(monkeypatch, web_app_dist)
        res = TestClient(app).get("/app/assets/index-test.js")
        assert res.status_code == 200
        assert "immutable" in res.headers.get("cache-control", "")
        assert "javascript" in res.headers["content-type"]

    def test_dist_file_served_as_file_not_index(self, monkeypatch, web_app_dist):
        app = _fresh_mounted_app(monkeypatch, web_app_dist)
        res = TestClient(app).get("/app/emojibase/en/data.json")
        assert res.status_code == 200
        assert res.text == '{"emojis": []}'

    def test_deep_non_file_path_redirects_to_canonical_app_url(self, monkeypatch, web_app_dist):
        app = _fresh_mounted_app(monkeypatch, web_app_dist)
        res = TestClient(app, follow_redirects=False).get("/app/session/abc/def")
        assert res.status_code == 307
        assert res.headers["location"] == "/app/"

    def test_traversal_never_escapes_dist(self, monkeypatch, web_app_dist):
        app = _fresh_mounted_app(monkeypatch, web_app_dist)
        client = TestClient(app)
        # httpx normalizes ../ client-side and the route re-resolves within the
        # dist; either way the invariant is that no host file content leaks.
        for probe in ("/app/../../etc/passwd", "/app/..%2f..%2fetc%2fpasswd"):
            res = client.get(probe)
            assert "root:" not in res.text
            assert res.status_code == 200 or res.status_code in (400, 404)


class TestGate:
    def test_app_paths_are_not_public(self):
        from hermes_cli.dashboard_auth.middleware import _path_is_public

        assert not _path_is_public("/app")
        assert not _path_is_public("/app/assets/index-test.js")

    def test_gated_app_redirects_to_login(self, monkeypatch, web_app_dist):
        app = _fresh_mounted_app(monkeypatch, web_app_dist)
        _gated(app)
        res = TestClient(app, follow_redirects=False).get("/app")
        assert res.status_code == 302
        assert res.headers["location"].startswith("/login")

    def test_gated_ws_ticket_unauthorized_without_session(self, monkeypatch, web_app_dist):
        from hermes_cli.dashboard_auth.routes import router as dashboard_auth_router

        app = _fresh_mounted_app(monkeypatch, web_app_dist)
        _gated(app)
        app.include_router(dashboard_auth_router)
        res = TestClient(app).post("/api/auth/ws-ticket")
        assert res.status_code in (401, 403)
