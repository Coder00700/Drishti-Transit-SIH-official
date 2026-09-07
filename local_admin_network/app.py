import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pymongo.errors import PyMongoError
from .store import database, setup
from .routes import router, public
from . import evidence  # registers scoped evidence routes

def contributor_allowed(user_id, accepted_at):
    from deployment.render.mongo_store import database as accounts, logins
    from deployment.render.models import POLICY_VERSION
    if accepted_at is None:
        return False
    return bool(logins(accounts()).find_one({'id': user_id, 'withdrawn_at': None,
        'deletion_requested_at': None, 'privacy_version': POLICY_VERSION, 'accepted_at': accepted_at}, {'_id': 1}))

def attach(app, database_provider=database, demo=False, secure=True):
    app.state.authority_db = database_provider
    app.state.authority_demo = demo
    app.state.authority_secure = secure
    app.state.authority_contributor_allowed = contributor_allowed
    app.include_router(router)
    app.include_router(public)

class Boundary:
    def __init__(self, app):
        self.app = app
    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = dict(scope['headers'])
        if scope['method'] not in ('GET', 'HEAD', 'OPTIONS'):
            origin = os.environ.get('AUTHORITY_ORIGIN', 'http://127.0.0.1:3000')
            if headers.get(b'origin', b'').decode() != origin:
                return await JSONResponse({'detail': 'Invalid request origin.'}, 403)(scope, receive, send)
            if headers.get(b'content-type', b'').split(b';')[0] != b'application/json':
                return await JSONResponse({'detail': 'Use JSON for authority requests.'}, 415)(scope, receive, send)
        chunks, total = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            total += len(message.get('body', b''))
            if total > 2 * 1024 * 1024:
                return await JSONResponse({'detail': 'Request exceeds 2 MB. Split the dataset into smaller batches.'}, 413)(scope, receive, send)
            chunks.append(message.get('body', b''))
            if not message.get('more_body'):
                break
        consumed = False
        async def body():
            nonlocal consumed
            if not consumed:
                consumed = True
                return {'type': 'http.request', 'body': b''.join(chunks), 'more_body': False}
            return await receive()
        async def response(message):
            if message['type'] == 'http.response.start':
                message['headers'] += [(b'cache-control', b'no-store'), (b'x-content-type-options', b'nosniff'),
                                       (b'referrer-policy', b'no-referrer'), (b'x-frame-options', b'DENY')]
            await send(message)
        await self.app(scope, body, response)

def create_app(database_provider=database, demo=False):
    @asynccontextmanager
    async def lifespan(app):
        setup(database_provider())
        yield
    app = FastAPI(title='Drishti Authority Network', docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    attach(app, database_provider, demo, secure=os.environ.get('AUTHORITY_ORIGIN', '').startswith('https://'))
    app.add_middleware(Boundary)
    @app.exception_handler(PyMongoError)
    async def unavailable(request, exc):
        return JSONResponse({'detail': 'Authority database unavailable. Retry shortly.'}, 503)
    @app.exception_handler(RequestValidationError)
    async def invalid(request, exc):
        return JSONResponse({'detail': 'Some fields are invalid. Check required fields, dates and file format.'}, 422)
    @app.exception_handler(Exception)
    async def unavailable_storage(request, exc):
        return JSONResponse({'detail': 'Operation could not complete. Refresh its status before retrying.'}, 503)
    @app.get('/health')
    def health():
        return {'status': 'ok', 'service': 'authority-network', 'demo': demo}
    return app

app = create_app()

