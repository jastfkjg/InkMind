# Backend regression tests

From `backend/`, with the backend dependencies installed:

```bash
DATABASE_URL=sqlite:// python -m unittest discover -s tests -v
```

The suite creates an isolated in-memory SQLite database for each test and uses a
fake LLM. It does not start the application lifespan, access the writing library,
or send requests to a model provider. No extra test framework is required.

Coverage includes chapter-relative context for direct generation, ReAct/Flexible
tools and workflows; append/insertion boundaries; Chinese/English character-name
recall; chapter timestamp serialization; and HTTP version comparison/detail routes.
