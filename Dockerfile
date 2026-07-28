# =============================================================================
# Stage 1: Build SQLite database from question bank
# =============================================================================
FROM python:3.12-alpine AS db-builder

WORKDIR /build

# Copy question bank and build script
COPY question_bank/ /question_bank/
COPY scripts/build_database.py /build/

# Set environment variables for build
ENV DATABASE_PATH=/build/questions.db
ENV QUESTION_BANK_PATH=/question_bank

# Build the database
RUN python build_database.py

# =============================================================================
# Stage 2: Combined production image with nginx + API
# =============================================================================
FROM nginx:1-alpine-slim

# Install dependencies
RUN apk add --no-cache \
    gettext \
    openssl \
    python3 \
    py3-pip \
    supervisor

# Create non-root application user (UID/GID 1000)
RUN addgroup -g 1000 appuser && adduser -u 1000 -G appuser -S appuser

# Create required directories
RUN mkdir -p /var/log/supervisor /var/run/supervisor /etc/nginx/snippets /data /uploads && \
    chown -R appuser:appuser /data /uploads

# Create virtual environment and install Python packages
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY api/requirements.txt /tmp/
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy nginx configs
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf

# Copy app files
COPY app/ /usr/share/nginx/html/

# Create template for environment variable substitution
RUN mv /usr/share/nginx/html/index.html /usr/share/nginx/html/index.html.template

# Copy API
COPY api/server.py /app/server.py
RUN chown appuser:appuser /app/server.py

# Copy database from builder stage to a seed location
COPY --from=db-builder /build/questions.db /seed/questions.db
RUN chown appuser:appuser /seed/questions.db

# Copy supervisor config
COPY supervisor/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create startup script that processes template and starts supervisor
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'set -e' >> /start.sh && \
    echo '# Auto-generate cryptographic secrets if not supplied' >> /start.sh && \
    echo 'if [ -z "$JWT_SECRET" ]; then' >> /start.sh && \
    echo '  export JWT_SECRET=$(openssl rand -hex 32)' >> /start.sh && \
    echo '  echo "[startup] JWT_SECRET auto-generated (set JWT_SECRET env var to persist across restarts)"' >> /start.sh && \
    echo 'fi' >> /start.sh && \
    echo 'if [ -z "$SECRET_KEY" ]; then' >> /start.sh && \
    echo '  export SECRET_KEY=$(openssl rand -hex 32)' >> /start.sh && \
    echo 'fi' >> /start.sh && \
    echo '# Seed database into /data if not already present (supports bind mounts)' >> /start.sh && \
    echo 'if [ ! -f /data/questions.db ]; then' >> /start.sh && \
    echo '  echo "[startup] Seeding database into /data..."' >> /start.sh && \
    echo '  cp /seed/questions.db /data/questions.db' >> /start.sh && \
    echo 'fi' >> /start.sh && \
    echo '# Ensure appuser can write the database (bind mounts may retain root ownership)' >> /start.sh && \
    echo 'chmod 666 /data/questions.db 2>/dev/null || true' >> /start.sh && \
    echo 'chown appuser:appuser /data/questions.db 2>/dev/null || true' >> /start.sh && \
    echo 'envsubst '"'"'${APP_TITLE}'"'"' < /usr/share/nginx/html/index.html.template > /usr/share/nginx/html/index.html' >> /start.sh && \
    echo 'exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf' >> /start.sh && \
    chmod +x /start.sh

# Environment
ENV APP_TITLE="Trivia Quest"
ENV DATABASE_PATH=/data/questions.db
ENV API_PORT=5000
ENV ADMIN_PASSWORD=admin123
ENV ACCOUNTS_ENABLED=true
ENV REQUIRE_USER_PASSWORD=false
ENV TRUST_PROXY=false
ENV MAX_UPLOAD_MB=25
ENV LOGIN_RATE_MAX=5
ENV LOGIN_RATE_WINDOW=900
ENV PATH="/opt/venv/bin:$PATH"
# JWT_SECRET and SECRET_KEY are auto-generated at runtime if not set

# Expose ports
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost/ && wget -q --spider http://localhost/api/health || exit 1

# Run startup script
CMD ["/start.sh"]
