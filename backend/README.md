# AI-try-on Backend Module

This directory contains the FastAPI server and the model adapters used by the virtual try-on flow.

## Run

```bash
./start.sh
```

The server runs on `http://localhost:8000` by default.

### First run notes

- Run the script with Bash, not `sh`.
- The script creates `.env` from `env.template` and sets up `.venv` on the first run.
- The startup script uses the virtual environment Python directly, so it does not depend on a shell `python` alias.
- Fill in the API key values in `.env` before using the real model providers.

## Environment

- `GEMINI_API_KEY` for `nano-banana` and `nano-banana-pro`
- `DASHSCOPE_API_KEY` for `wan-xiang`
- `API_SERVER_HOST`, `API_SERVER_PORT`, and `DEBUG` are optional
- `RETURN_MODEL_IMAGE_DIRECTLY` can be set to `true` for local UI-only testing, but it should stay `false` when validating real model calls

### MySQL

- The backend now supports a local MySQL database through SQLAlchemy.
- Use `docker compose up -d mysql adminer` from the project root to start the database.
- `DATABASE_URL` is read from `.env`; the default template points to `127.0.0.1:3306`.
- The backend creates its tables on startup and seeds the product catalog when the database is available.
- Adminer is exposed at `http://localhost:8081` for quick inspection.

## Structure

- `api_server.py` - FastAPI entrypoint
- `tryon/api/` - model adapters
- `requirements.txt` - Python dependencies
- `environment.yml` - Conda environment definition
- `env.template` - example environment file
- `outputs/` - generated images and artifacts

## Notes

- `env.template` only includes the keys used by the current backend.
- `outputs/virtual_tryon` is created at runtime and stores generated images.
- `POST /api/v1/virtual-tryon/jobs` starts an async generation job and `GET /api/v1/virtual-tryon/jobs/{job_id}` returns progressive status plus partial images.
- `POST /api/v1/virtual-tryon/model-image` generates a virtual model image from a text prompt. The frontend uses this endpoint when you choose `Generate by Text` in the model image card.
- The generated model image is returned as a base64 data URL and is also saved under `outputs/virtual_tryon/` for local inspection.

### Database-backed APIs

- `GET /health/db` checks whether the backend can talk to MySQL.
- `GET /api/v1/catalog/products` lists seeded products and SKUs from MySQL.
- `GET /api/v1/catalog/products/{slug}` returns one product and its SKUs.
- `POST /api/v1/auth/register` and `POST /api/v1/auth/login` store and read user records from MySQL.