from fastapi.testclient import TestClient

from main import app, engine
from wiki_engine import WikiPage


client = TestClient(app)


def _seed_pages() -> None:
    engine.pages = {}

    p1 = WikiPage(
        url="https://en.wikipedia.org/wiki/Spider-Man",
        title="Spider-Man",
        body="Spider hero from Marvel comics",
        page_num=0,
        outgoing_urls=[
            "https://en.wikipedia.org/wiki/Marvel_Comics",
            "https://en.wikipedia.org/wiki/Superhero",
        ],
    )
    p2 = WikiPage(
        url="https://en.wikipedia.org/wiki/Marvel_Comics",
        title="Marvel Comics",
        body="Marvel publishes Spider-Man and superhero stories",
        page_num=1,
        outgoing_urls=["https://en.wikipedia.org/wiki/Spider-Man"],
    )
    p3 = WikiPage(
        url="https://en.wikipedia.org/wiki/Superhero",
        title="Superhero",
        body="A superhero is a heroic character with powers",
        page_num=2,
        outgoing_urls=["https://en.wikipedia.org/wiki/Spider-Man"],
    )

    engine.pages = {p1.url: p1, p2.url: p2, p3.url: p3}
    engine._recompute_graph_stats()


def test_landing_page_renders() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "Wikipedia Web Crawler + Recommender" in response.text


def test_personal_search_json_response() -> None:
    _seed_pages()
    response = client.get("/personal?q=spider&boost=on&limit=5", headers={"accept": "application/json"})
    assert response.status_code == 200

    payload = response.json()
    assert isinstance(payload, list)
    assert len(payload) >= 1
    assert {"name", "url", "score", "title", "pr"}.issubset(payload[0].keys())


def test_page_data_json_and_not_found() -> None:
    _seed_pages()

    ok = client.get("/data/1", headers={"accept": "application/json"})
    assert ok.status_code == 200
    ok_payload = ok.json()
    assert ok_payload["title"] == "Spider-Man"
    assert "incomingUrls" in ok_payload
    assert "outgoingUrls" in ok_payload

    missing = client.get("/data/999", headers={"accept": "application/json"})
    assert missing.status_code == 404
    assert missing.json()["error"] == "Page not found"


def test_recommendations_json() -> None:
    _seed_pages()
    response = client.get("/recommend/1?top_k=3", headers={"accept": "application/json"})
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    if payload:
        assert {"name", "url", "title", "similarity"}.issubset(payload[0].keys())