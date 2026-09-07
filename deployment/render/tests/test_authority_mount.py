"""Verify that the opt-in authority surface is mounted by the Render app."""
import importlib.util
import os
from pathlib import Path
from unittest.mock import Mock, patch

import mongomock
from fastapi.testclient import TestClient

from deployment.render.mongo_store import ensure_indexes, password_hash
from local_admin_network.store import setup


def test_authority_mount_isolated_from_contributor_session():
    origin = "https://authority-test.pages.dev"
    settings = {
        "AUTHORITY_ENABLED": "true",
        "PORTAL_ORIGIN": origin,
        "EDGE_SHARED_SECRET": "x" * 48,
        "MONGODB_LOGIN_COLLECTION": "login",
        "DRISHTI_LOCAL_MONGO": "false",
    }
    accounts = mongomock.MongoClient(tz_aware=True).Users
    authority = mongomock.MongoClient(tz_aware=True).DrishtiAuthority
    accounts.command = Mock(return_value={"ok": 1})
    authority.command = Mock(return_value={"ok": 1})
    ensure_indexes(accounts)
    setup(authority)
    authority.admins.insert_one({
        "_id": "test-admin",
        "id": "test-admin",
        "secure_id": "delhi-test",
        "name": "Delhi test",
        "area_id": "delhi",
        "level": "GLOBAL",
        "slot": 1,
        "password_hash": password_hash("isolated-cloud-test-password"),
        "active": True,
    })

    with patch.dict(os.environ, settings):
        path = Path(__file__).resolve().parents[1] / "cloud_api.py"
        spec = importlib.util.spec_from_file_location(
            "deployment.render.authority_mount_test_api", path
        )
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
        api.app.state.authority_db = lambda: authority
        with patch.object(api, "database", return_value=accounts):
            with TestClient(
                api.app,
                base_url=origin,
                headers={"origin": origin, "x-drishti-edge": "x" * 48},
            ) as client:
                login = client.post(
                    "/api/v1/authority/login",
                    json={
                        "secure_id": "delhi-test",
                        "password": "isolated-cloud-test-password",
                    },
                )
                assert login.status_code == 200
                assert "Secure" in login.headers["set-cookie"]
                client.headers["x-authority-csrf"] = login.json()["csrf"]
                assert client.get("/api/v1/contributors/me").status_code == 401
                assert client.get("/api/v1/contributors/evidence").status_code == 401
                assert client.get("/api/v1/public/roads").status_code == 200
                assert client.post("/api/v1/authority/logout", json={}).status_code == 200
