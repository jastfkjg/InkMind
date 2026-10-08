# Backend regression tests

From `backend/`, with the backend dependencies installed:

```bash
python -m pip install -r requirements-dev.txt
DATABASE_URL=sqlite:// python -m pytest tests -q
```

The suite creates an isolated in-memory SQLite database for each test and uses a
fake LLM. It does not start the application lifespan, access the writing library,
or send requests to a model provider. Pytest runs both the unittest classes and
the fixture-based billing tests.

Coverage includes chapter-relative context for direct generation, ReAct/Flexible
tools and workflows; append/insertion boundaries; Chinese/English character-name
recall; chapter timestamp serialization; HTTP version comparison/detail routes;
library word/chapter summaries and ownership isolation; and opt-in first-chapter
creation without changing existing API clients.
