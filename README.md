# AI-try-on

This repository is now split into two independent modules:

- [frontend](frontend) - Next.js web app for virtual try-on
- [backend](backend) - FastAPI server plus model adapters

The old mixed demo structure has been removed so each side can be run and maintained separately.
# AI-try-on

This repository is split into two independent modules:

- [frontend](frontend) - Next.js web app for virtual try-on
- [backend](backend) - FastAPI server plus model adapters

## Run the backend

```bash
cd backend
cp env.template .env
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python api_server.py
```

## Run the frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## Runtime contract

- Backend default: `http://localhost:8000`
- Frontend default: `http://localhost:3001`
- Frontend uses `NEXT_PUBLIC_API_URL` to call the backend
- Supported providers: `nano-banana`, `nano-banana-pro`, `wan-xiang`

## Notes

- API keys live in `backend/.env`.
- The frontend does not require model keys.
- Generated images are written under `backend/outputs/virtual_tryon`.
    transform=transform
