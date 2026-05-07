from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, Form, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from wiki_engine import WikiEngine


app = FastAPI(title="Wikipedia Crawler + Recommender")
templates = Jinja2Templates(directory="templates")
engine = WikiEngine()


@app.get("/", response_class=HTMLResponse)
def landing_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "request": request,
            "page_count": len(engine.pages),
            "seed_url": "https://en.wikipedia.org/wiki/Spider-Man",
        },
    )


@app.post("/crawl", response_class=HTMLResponse)
def crawl_pages(
    request: Request,
    wiki_url: Optional[str] = Form(default=None),
    query: Optional[str] = Form(default=None),
    limit: int = Form(default=1000),
) -> HTMLResponse:
    if wiki_url and wiki_url.strip():
        seed_url = wiki_url.strip()
    else:
        seed_url = engine.query_to_wiki_url(query or "")

    effective_limit = max(1, min(1000, limit))
    crawled = engine.crawl(seed_url=seed_url, limit=effective_limit)

    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "request": request,
            "page_count": len(engine.pages),
            "seed_url": seed_url,
            "message": f"Crawl complete. Indexed {crawled} Wikipedia pages.",
        },
    )


@app.get("/searchPersonal", response_class=HTMLResponse)
def search_personal_ui(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "results.html",
        {"request": request, "results": [], "query": "", "boost": "on", "limit": 10},
    )


@app.get("/personal")
def personal_search(
    request: Request,
    q: str = Query(default=""),
    boost: str = Query(default="on"),
    limit: int = Query(default=10),
):
    boost_on = boost.lower() != "off"
    results = engine.search(query=q, limit=max(1, limit), boost=boost_on)

    if "application/json" in request.headers.get("accept", "").lower():
        return JSONResponse(content=results)

    return templates.TemplateResponse(
        request,
        "results.html",
        {
            "request": request,
            "results": results,
            "query": q,
            "boost": "on" if boost_on else "off",
            "limit": max(1, limit),
        },
    )


@app.get("/data/{page_id}")
def page_data(request: Request, page_id: int):
    page = engine.get_page_by_id(page_id)
    if page is None:
        if "application/json" in request.headers.get("accept", "").lower():
            return JSONResponse(content={"error": "Page not found"}, status_code=404)
        return templates.TemplateResponse(
            request,
            "data.html",
            {"request": request, "page": None, "recommendations": []},
            status_code=404,
        )

    payload = {
        "url": page.url,
        "title": page.title,
        "body": page.body,
        "incomingUrls": page.incoming_urls,
        "outgoingUrls": page.outgoing_urls,
        "incomingCount": page.incoming_count,
        "outgoingCount": page.outgoing_count,
        "pageRank": page.page_rank,
    }

    if "application/json" in request.headers.get("accept", "").lower():
        return JSONResponse(content=payload)

    recommendations = engine.recommend(page_id=page_id, top_k=5)
    return templates.TemplateResponse(
        request,
        "data.html",
        {"request": request, "page": payload, "recommendations": recommendations},
    )


@app.get("/recommend/{page_id}")
def recommend(request: Request, page_id: int, top_k: int = Query(default=5)):
    recs = engine.recommend(page_id=page_id, top_k=max(1, top_k))
    if "application/json" in request.headers.get("accept", "").lower():
        return JSONResponse(content=recs)
    return templates.TemplateResponse(
        request,
        "data.html",
        {"request": request, "page": None, "recommendations": recs},
    )