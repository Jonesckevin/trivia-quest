FROM nginx:alpine

# Install envsubst (part of gettext)
RUN apk add --no-cache gettext

# Copy app files to nginx html directory
COPY app/ /usr/share/nginx/html/

# Create template from index.html for environment variable substitution
RUN mv /usr/share/nginx/html/index.html /usr/share/nginx/html/index.html.template

# Default environment variable
ENV APP_TITLE="Trivia Quest"

# Create startup script that substitutes environment variables
RUN echo '#!/bin/sh' > /docker-entrypoint.d/40-envsubst-app-title.sh && \
    echo 'envsubst '"'"'${APP_TITLE}'"'"' < /usr/share/nginx/html/index.html.template > /usr/share/nginx/html/index.html' >> /docker-entrypoint.d/40-envsubst-app-title.sh && \
    chmod +x /docker-entrypoint.d/40-envsubst-app-title.sh

# Expose port 80
EXPOSE 80

# nginx runs automatically as the default command
