# Wikipedia Web Crawler + Recommender (Python)

A Python-based Wikipedia crawler and recommender system with a web UI.

You can:
1. Start from a Wikipedia URL or a search phrase,
2. Crawl linked Wikipedia pages with a hard cap (up to 1000),
3. Search indexed pages with optional PageRank boosting,
4. View page-level data and recommendations.

---

## Tech Stack

- **Backend:** FastAPI
- **Templating:** Jinja2
- **Crawler:** `requests` + `BeautifulSoup`
- **Ranking/Relevance:** TF-IDF-like scoring + PageRank
- **Testing:** pytest + FastAPI TestClient

---

## Project Structure

- `main.py` — FastAPI routes and app entrypoint
- `wiki_engine.py` — crawl, indexing, PageRank, search, recommendations
- `templates/index.html` — landing page (crawl form)
- `templates/results.html` — search UI/results
- `templates/data.html` — page details + recommendations
- `test_main.py` — API/route tests
- `requirements.txt` — dependencies

---

## Features

- Crawl from:
  - direct Wikipedia URL (`https://en.wikipedia.org/wiki/...`)
  - plain query (converted to a Wikipedia URL)
- Wikipedia link filtering:
  - includes only `/wiki/...`
  - excludes namespace links (`:`), fragments (`#`), disambiguation pages, and Main Page
- Per-page outgoing link cap: **20**
- Global crawl cap: **1000**
- Search endpoint supports:
  - query text (`q`)
  - PageRank boost (`boost=on|off`)
  - result limit (`limit`)

---

## Installation

```bash
pip install -r requirements.txt
```

---

## Run the App

```bash
uvicorn main:app --reload
```

Open:
- `http://127.0.0.1:8000/`

---

## App Flow

1. Open `/`
2. Enter:
   - Wikipedia URL **or**
   - Search phrase
3. Set crawl limit (max 1000)
4. Click **Start Crawl**
5. Go to `/searchPersonal` and search indexed content
6. Open `/data/{id}` for details and `/recommend/{id}` for recommendations

---

## Routes

### UI Routes
- `GET /` — landing page
- `POST /crawl` — trigger crawl
- `GET /searchPersonal` — search UI
- `GET /data/{page_id}` — page detail UI
- `GET /recommend/{page_id}` — recommendations UI

### API Behavior (Content Negotiation)
The following return JSON when request `Accept` header includes `application/json`:

- `GET /personal?q=<query>&boost=on|off&limit=<n>`
  - Returns:
    ```json
    [
      {
        "name": 1,
        "url": "https://en.wikipedia.org/wiki/Spider-Man",
        "score": 0.123,
        "title": "Spider-Man",
        "pr": 0.045
      }
    ]
    ```

- `GET /data/{page_id}`
  - Returns page metadata, body, links, counts, and PageRank

- `GET /recommend/{page_id}?top_k=<n>`
  - Returns recommended pages with similarity score

---

## Testing

```bash
python -m pytest -q
```

Current status: tests pass.

---

## Notes

- The current implementation stores index/crawl state **in memory**.
- For production-scale usage, recommended next steps:
  - persist pages in MongoDB/PostgreSQL
  - add async/background crawling jobs
  - add pagination and caching for large result sets
  - add rate limiting and retry/backoff policies for crawling
