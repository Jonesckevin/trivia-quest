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
FROM nginx:alpine

# Install dependencies
RUN apk add --no-cache \
    gettext \
    python3 \
    py3-pip \
    supervisor

# Create required directories
RUN mkdir -p /var/log/supervisor /var/run/supervisor /etc/nginx/snippets /data

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

# Copy database from builder stage
COPY --from=db-builder /build/questions.db /data/questions.db

# Copy supervisor config
COPY supervisor/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create startup script that processes template and starts supervisor
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'set -e' >> /start.sh && \
    echo 'envsubst '"'"'${APP_TITLE}'"'"' < /usr/share/nginx/html/index.html.template > /usr/share/nginx/html/index.html' >> /start.sh && \
    echo 'exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf' >> /start.sh && \
    chmod +x /start.sh

# Environment
ENV APP_TITLE="Trivia Quest"
ENV DATABASE_PATH=/data/questions.db
ENV API_PORT=5000
ENV PATH="/opt/venv/bin:$PATH"

# Expose ports
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost/ && wget -q --spider http://localhost/api/health || exit 1

# Run startup script
CMD ["/start.sh"]
