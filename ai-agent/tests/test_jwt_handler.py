"""
Regression test for the hotel_auth bug found during the end-to-end test
pass: it was meant to reject police tokens, but checked payload["role"]
against ("admin_police", "sub_police") - values that only ever appear in
payload["policeRole"]. Node signs police tokens with role="police" (a
generic marker) and policeRole="admin_police"/"sub_police" as separate
fields, so the check never matched anything.

It was harmless only by accident: a police payload also lacks hotelId/id,
so hotel_auth still ended up rejecting it via a different check ("hotel_id
missing from token") - the wrong reason, not the intended one. This test
locks in that the *intended* check now actually fires, using real
Node-issued tokens (generated the same way backend/controllers/
policeAuthController.js and hotelAuthController.js do), not hand-rolled
payloads.
"""
import os
import subprocess
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

TEST_SECRET = "test-secret-at-least-32-characters-long!!"

os.environ.setdefault("MONGODB_URI", "mongodb://127.0.0.1:27017/test")
os.environ.setdefault("JWT_SECRET", TEST_SECRET)
os.environ.setdefault("NVIDIA_API_KEY", "fake-key-for-tests")

from auth.jwt_handler import hotel_auth, police_auth  # noqa: E402


def _node_sign(payload_js: str) -> str:
    """
    Sign a JWT the same way the Node backend does, using Node itself (the
    backend's own jsonwebtoken dependency) rather than reimplementing JWT
    signing in Python - so this test proves cross-service compatibility
    with the real signer, not just with jose's own encoder.
    """
    script = f"""
    const jwt = require('jsonwebtoken');
    console.log(jwt.sign({payload_js}, '{TEST_SECRET}', {{ expiresIn: '1h' }}));
    """
    backend_dir = os.path.join(os.path.dirname(__file__), "..", "..", "backend")
    result = subprocess.run(
        ["node", "-e", script], cwd=backend_dir, capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


@pytest.fixture(scope="module")
def police_token():
    return _node_sign(
        """{
            policeId: 'p1', role: 'police', policeRole: 'sub_police',
            badgeNumber: 'B100', name: 'Test Officer', station: 'Test Station', rank: 'SI'
        }"""
    )


@pytest.fixture(scope="module")
def admin_police_token():
    return _node_sign(
        """{
            policeId: 'p2', role: 'police', policeRole: 'admin_police',
            badgeNumber: 'B200', name: 'Test Admin', station: 'Test Station', rank: 'Inspector'
        }"""
    )


@pytest.fixture(scope="module")
def hotel_token():
    return _node_sign("""{ hotelId: 'h1', id: 'h1', type: 'hotel', name: 'Test Hotel' }""")


@pytest.mark.asyncio
async def test_hotel_auth_rejects_a_real_sub_police_token(police_token):
    with pytest.raises(HTTPException) as exc_info:
        await hotel_auth(_creds(police_token))
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "This endpoint requires a hotel token"


@pytest.mark.asyncio
async def test_hotel_auth_rejects_a_real_admin_police_token(admin_police_token):
    with pytest.raises(HTTPException) as exc_info:
        await hotel_auth(_creds(admin_police_token))
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "This endpoint requires a hotel token"


@pytest.mark.asyncio
async def test_hotel_auth_accepts_a_real_hotel_token(hotel_token):
    result = await hotel_auth(_creds(hotel_token))
    assert result.hotel_id == "h1"
    assert result.name == "Test Hotel"


@pytest.mark.asyncio
async def test_police_auth_rejects_a_real_hotel_token(hotel_token):
    with pytest.raises(HTTPException) as exc_info:
        await police_auth(_creds(hotel_token))
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_police_auth_accepts_a_real_police_token(police_token):
    result = await police_auth(_creds(police_token))
    assert result.user_id == "p1"
    assert result.role == "sub_police"
    assert result.is_admin is False
