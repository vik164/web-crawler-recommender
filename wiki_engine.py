from __future__ import annotations

import math
import re
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from urllib.parse import quote, urljoin

import requests
from bs4 import BeautifulSoup


TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


@dataclass
class WikiPage:
    url: str
    title: str
    body: str
    page_num: int
    incoming_urls: List[str] = field(default_factory=list)
    outgoing_urls: List[str] = field(default_factory=list)
    page_rank: float = 0.0

    @property
    def incoming_count(self) -> int:
        return len(self.incoming_urls)

    @property
    def outgoing_count(self) -> int:
        return len(self.outgoing_urls)


class WikiEngine:
    def __init__(self) -> None:
        self.pages: Dict[str, WikiPage] = {}
        self.session = requests.Session()
        self.session.headers.update(
            {"User-Agent": "WikiCrawlerRecommender/1.0 (+https://example.local)"}
        )

    @staticmethod
    def query_to_wiki_url(query: str) -> str:
        query = query.strip()
        if not query:
            return "https://en.wikipedia.org/wiki/Spider-Man"
        return f"https://en.wikipedia.org/wiki/{quote(query.replace(' ', '_'))}"

    @staticmethod
    def _is_valid_wiki_link(href: str) -> bool:
        if not href or not href.startswith("/wiki/"):
            return False
        if ":" in href or "#" in href:
            return False
        lowered = href.lower()
        if "disambiguation" in lowered or "main_page" in lowered:
            return False
        return True

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        return [m.group(0).lower() for m in TOKEN_RE.finditer(text)]

    def _fetch_page(self, url: str) -> Optional[tuple[str, str, List[str]]]:
        try:
            response = self.session.get(url, timeout=10)
            if response.status_code != 200:
                return None
        except requests.RequestException:
            return None

        soup = BeautifulSoup(response.text, "html.parser")
        title_tag = soup.select_one("#firstHeading")
        title = title_tag.get_text(" ", strip=True) if title_tag else soup.title.get_text(" ", strip=True)

        paragraphs = soup.select("#mw-content-text p")
        body = " ".join(p.get_text(" ", strip=True) for p in paragraphs if p.get_text(strip=True))

        raw_links = soup.select('a[href^="/wiki/"]')
        outgoing: List[str] = []
        seen = set()
        for a in raw_links:
            href = a.get("href", "")
            if not self._is_valid_wiki_link(href):
                continue
            absolute = urljoin("https://en.wikipedia.org", href)
            if absolute in seen:
                continue
            seen.add(absolute)
            outgoing.append(absolute)
            if len(outgoing) >= 20:
                break

        return title, body, outgoing

    def crawl(self, seed_url: str, limit: int = 1000) -> int:
        self.pages = {}
        visited = set()
        queue = deque([seed_url])

        while queue and len(self.pages) < limit:
            current = queue.popleft()
            if current in visited:
                continue
            visited.add(current)

            fetched = self._fetch_page(current)
            if not fetched:
                continue

            title, body, outgoing = fetched
            page = WikiPage(
                url=current,
                title=title,
                body=body,
                page_num=len(self.pages),
                outgoing_urls=list(outgoing),
            )
            self.pages[current] = page

            for out in outgoing:
                if out not in visited and out not in queue and len(self.pages) + len(queue) < limit:
                    queue.append(out)

        self._recompute_graph_stats()
        return len(self.pages)

    def _recompute_graph_stats(self) -> None:
        for page in self.pages.values():
            page.incoming_urls = []
            page.outgoing_urls = [u for u in page.outgoing_urls if u in self.pages]

        for page in self.pages.values():
            for out in page.outgoing_urls:
                self.pages[out].incoming_urls.append(page.url)

        self._compute_pagerank()

    def _compute_pagerank(self, alpha: float = 0.1, iterations: int = 20) -> None:
        n = len(self.pages)
        if n == 0:
            return

        urls = list(self.pages.keys())
        rank = {u: 1.0 / n for u in urls}
        damp = 1.0 - alpha

        for _ in range(iterations):
            new_rank = {u: alpha / n for u in urls}
            for u in urls:
                outs = self.pages[u].outgoing_urls
                if outs:
                    share = damp * rank[u] / len(outs)
                    for v in outs:
                        new_rank[v] += share
                else:
                    share = damp * rank[u] / n
                    for v in urls:
                        new_rank[v] += share
            rank = new_rank

        for u in urls:
            self.pages[u].page_rank = rank[u]

    def _idf(self) -> Dict[str, float]:
        n = len(self.pages)
        df: Counter = Counter()
        for page in self.pages.values():
            tokens = set(self._tokenize(f"{page.title} {page.body}"))
            df.update(tokens)
        return {term: math.log((n + 1) / (count + 1)) + 1.0 for term, count in df.items()}

    def search(self, query: str, limit: int = 10, boost: bool = True) -> List[dict]:
        tokens = self._tokenize(query)
        if not tokens:
            return []

        idf = self._idf()
        results = []
        for i, page in enumerate(self.pages.values(), start=1):
            doc_tokens = self._tokenize(f"{page.title} {page.body}")
            tf = Counter(doc_tokens)
            score = sum(tf[t] * idf.get(t, 0.0) for t in tokens)
            if score <= 0:
                continue
            if boost:
                score *= page.page_rank
            results.append(
                {
                    "name": i,
                    "url": page.url,
                    "score": score,
                    "title": page.title,
                    "pr": page.page_rank,
                }
            )

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[: max(1, limit)]

    def get_page_by_id(self, page_id: int) -> Optional[WikiPage]:
        if page_id < 1 or page_id > len(self.pages):
            return None
        return list(self.pages.values())[page_id - 1]

    def recommend(self, page_id: int, top_k: int = 5) -> List[dict]:
        target = self.get_page_by_id(page_id)
        if not target:
            return []

        idf = self._idf()

        def to_vec(page: WikiPage) -> Dict[str, float]:
            tf = Counter(self._tokenize(f"{page.title} {page.body}"))
            return {t: tf[t] * idf.get(t, 0.0) for t in tf}

        target_vec = to_vec(target)

        def cosine(a: Dict[str, float], b: Dict[str, float]) -> float:
            dot = sum(v * b.get(k, 0.0) for k, v in a.items())
            na = math.sqrt(sum(v * v for v in a.values()))
            nb = math.sqrt(sum(v * v for v in b.values()))
            if na == 0 or nb == 0:
                return 0.0
            return dot / (na * nb)

        recs = []
        for i, page in enumerate(self.pages.values(), start=1):
            if page.url == target.url:
                continue
            score = cosine(target_vec, to_vec(page))
            if score > 0:
                recs.append(
                    {
                        "name": i,
                        "url": page.url,
                        "title": page.title,
                        "similarity": score,
                    }
                )

        recs.sort(key=lambda x: x["similarity"], reverse=True)
        return recs[: max(1, top_k)]