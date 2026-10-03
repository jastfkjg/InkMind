FROM node:22-slim AS cli-builder

RUN npm config set registry https://registry.npmmirror.com && \
    npm install -g @anthropic-ai/claude-code && \
    npm cache clean --force

FROM python:3.12-slim AS base

RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true

RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libffi-dev curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=cli-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=cli-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe /usr/local/bin/claude

RUN groupadd -g 1000 appuser && useradd -u 1000 -g appuser -d /app -s /sbin/nologin appuser

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir --index-url https://pypi.org/simple -r requirements.txt

COPY . .

RUN mkdir -p /app/data && chown -R appuser:appuser /app/data && chown -R appuser:appuser /app

USER appuser

ARG VCS_REF=development
ENV INKMIND_REVISION=$VCS_REF HOME=/app/data/home
RUN mkdir -p /app/data/home
VOLUME /app/data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
