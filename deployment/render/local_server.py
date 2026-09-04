"""Run the Mongo account API locally without changing production security settings."""
import os
from pathlib import Path

from dotenv import load_dotenv
import uvicorn


def main():
    if os.environ.get('RENDER'):
        raise SystemExit('This launcher is for local development only.')
    load_dotenv(Path(__file__).with_name('.env'), override=False)
    os.environ['DRISHTI_LOCAL_MONGO'] = 'true'
    os.environ['PORTAL_ORIGIN'] = 'http://127.0.0.1:3000'
    uvicorn.run('deployment.render.cloud_api:app', host='127.0.0.1', port=8001,
                access_log=False, proxy_headers=False)


if __name__ == '__main__':
    main()
