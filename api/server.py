#!/usr/bin/env python3
"""
API server for Trivia Quest with quiz mode, user management, and admin features.
Uses Flask with security best practices.
"""

import json
import sqlite3
import os
import re
import csv
import io
import base64
import hashlib
import hmac
import uuid
import time
import threading
import logging
import mimetypes
from datetime import datetime
from functools import wraps
import jwt
import bcrypt
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
from flask import Flask, jsonify, request, g, Response
from flask_cors import CORS
from flask_socketio import SocketIO

try:
    import webauthn as _webauthn
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria,
        ResidentKeyRequirement,
        UserVerificationRequirement,
        RegistrationCredential,
        AuthenticatorAttestationResponse,
        AuthenticationCredential,
        AuthenticatorAssertionResponse,
        AuthenticatorTransport,
    )
    from webauthn.helpers import (
        base64url_to_bytes as _b64url_to_bytes,
        bytes_to_base64url as _bytes_to_b64url,
    )
    PASSKEY_SUPPORT = True
except ImportError:
    PASSKEY_SUPPORT = False

app = Flask(__name__)

# =============================================================================
# Configuration
# =============================================================================
DATABASE_PATH = os.environ.get('DATABASE_PATH', '/data/questions.db')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')
ACCOUNTS_ENABLED = os.environ.get('ACCOUNTS_ENABLED', 'true').lower() == 'true'
FREEPLAY_DEFAULT = not ACCOUNTS_ENABLED  # When accounts disabled, freeplay is always on
REQUIRE_USER_PASSWORD = os.environ.get('REQUIRE_USER_PASSWORD', 'false').lower() == 'true'
USER_PASSWORD_MIN_LENGTH = int(os.environ.get('USER_PASSWORD_MIN_LENGTH', '8'))
MAX_QUESTIONS_PER_REQUEST = 500

# WebAuthn / Passkey config
RP_ID = os.environ.get('RP_ID', 'localhost')
RP_NAME = os.environ.get('APP_TITLE', 'Trivia Quest')
_PK_ALLOW_LOCALHOST = True  # Allow passkeys from localhost by default
_PASSKEY_ORIGIN_OVERRIDE = os.environ.get('PASSKEY_ORIGIN', '').strip()
_pk_challenges: dict = {}
_pk_lock = threading.Lock()

# Avatar upload limits
MAX_AVATAR_BYTES = 2 * 1024 * 1024  # 2 MB
ALLOWED_AVATAR_MIMES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}

# JWT
JWT_SECRET = os.environ.get('JWT_SECRET') or os.urandom(32).hex()
JWT_TTL = int(os.environ.get('JWT_TTL_SECONDS', '86400'))
JWT_ISSUER = 'trivia-quest'

# Rate limiting
LOGIN_RATE_MAX = int(os.environ.get('LOGIN_RATE_MAX', '5'))
LOGIN_RATE_WINDOW = int(os.environ.get('LOGIN_RATE_WINDOW', '900'))
REG_RATE_MAX = int(os.environ.get('REG_RATE_MAX', '3'))
REG_RATE_WINDOW = int(os.environ.get('REG_RATE_WINDOW', '3600'))

# Proxy & upload
TRUST_PROXY = os.environ.get('TRUST_PROXY', 'false').lower() == 'true'
MAX_UPLOAD_MB = int(os.environ.get('MAX_UPLOAD_MB', '25'))
ALLOWED_UPLOAD_EXTENSIONS = {'.jsonl', '.json', '.csv'}

# CORS
CORS_ALLOWED_ORIGINS = [
    o.strip() for o in
    os.environ.get('CORS_ALLOWED_ORIGINS', os.environ.get('ALLOWED_ORIGINS', '*')).split(',')
    if o.strip()
]

# Flask security config
app.config['MAX_CONTENT_LENGTH'] = MAX_UPLOAD_MB * 1024 * 1024
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY') or os.urandom(32).hex()

# Proxy trust — use Werkzeug's ProxyFix instead of manual header parsing
if TRUST_PROXY:
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

# Security: Configure CORS
CORS(app, origins=CORS_ALLOWED_ORIGINS, methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
     supports_credentials=False)

# WebSocket / Socket.IO — security-hardened
socketio = SocketIO(
    app,
    cors_allowed_origins=CORS_ALLOWED_ORIGINS,
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=1 * 1024 * 1024,  # 1 MB max WS message
    async_mode='threading',
    logger=False,
    engineio_logger=False,
)

# Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# =============================================================================
# Security Middleware
# =============================================================================

# ---------------------------------------------------------------------------
# Rate limiting — sliding-window, failures-only for login (per live-translate)
# ---------------------------------------------------------------------------
_login_failures: dict = {}     # ip -> [timestamps of recent failures]
_register_attempts: dict = {}  # ip -> [timestamps of recent attempts]
_rl_lock = threading.Lock()


def _login_rate_ok(ip: str) -> bool:
    now = time.time()
    with _rl_lock:
        recent = [t for t in _login_failures.get(ip, []) if now - t < LOGIN_RATE_WINDOW]
        _login_failures[ip] = recent
        return len(recent) < LOGIN_RATE_MAX


def _record_login_failure(ip: str) -> None:
    with _rl_lock:
        _login_failures.setdefault(ip, []).append(time.time())


def _reset_login_failures(ip: str) -> None:
    with _rl_lock:
        _login_failures.pop(ip, None)


def _register_rate_ok(ip: str) -> bool:
    now = time.time()
    with _rl_lock:
        recent = [t for t in _register_attempts.get(ip, []) if now - t < REG_RATE_WINDOW]
        _register_attempts[ip] = recent
        return len(recent) < REG_RATE_MAX


def _record_register_attempt(ip: str) -> None:
    with _rl_lock:
        _register_attempts.setdefault(ip, []).append(time.time())


# ---------------------------------------------------------------------------
# Token revocation — direct DB access (no request context needed in decorators)
# ---------------------------------------------------------------------------
def _revocation_connect():
    conn = sqlite3.connect(DATABASE_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


def _ensure_revocation_table() -> None:
    try:
        with _revocation_connect() as conn:
            conn.execute(
                'CREATE TABLE IF NOT EXISTS revoked_tokens ('
                '  jti TEXT PRIMARY KEY,'
                '  expires_at INTEGER NOT NULL'
                ')'
            )
            conn.commit()
    except sqlite3.OperationalError:
        pass


def _is_token_revoked(jti: str) -> bool:
    if not jti:
        return False
    try:
        with _revocation_connect() as conn:
            return conn.execute(
                'SELECT 1 FROM revoked_tokens WHERE jti = ?', (jti,)
            ).fetchone() is not None
    except sqlite3.OperationalError:
        return False  # table not yet created — treat as not revoked


def _revoke_token(jti: str, exp: int) -> None:
    if not jti:
        return
    try:
        with _revocation_connect() as conn:
            conn.execute(
                'INSERT OR REPLACE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)',
                (jti, int(exp or 0))
            )
            conn.commit()
    except Exception:
        pass


def _cleanup_revoked_tokens() -> None:
    """Remove revocation entries whose JWTs have already expired."""
    try:
        with _revocation_connect() as conn:
            conn.execute('DELETE FROM revoked_tokens WHERE expires_at < ?', (int(time.time()),))
            conn.commit()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Password helpers — bcrypt with SHA256 legacy fallback for migration
# ---------------------------------------------------------------------------
_USERNAME_RE = re.compile(r'^[A-Za-z0-9_.\-]{3,32}$')


def _validate_username(username: str) -> str | None:
    if not isinstance(username, str) or not _USERNAME_RE.match(username or ''):
        return 'Username must be 3-32 characters: letters, numbers, dot, underscore, or hyphen'
    return None


def _validate_password(password: str) -> str | None:
    if not isinstance(password, str) or len(password) < USER_PASSWORD_MIN_LENGTH:
        return f'Password must be at least {USER_PASSWORD_MIN_LENGTH} characters'
    if len(password) > 128:
        return 'Password must be at most 128 characters'
    if not re.search(r'[a-z]', password):
        return 'Password must include a lowercase letter'
    if not re.search(r'[A-Z]', password):
        return 'Password must include an uppercase letter'
    if not re.search(r'[0-9]', password):
        return 'Password must include a number'
    return None


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def _verify_password(password: str, stored_hash: str) -> bool:
    """Verify against bcrypt hash; accepts SHA256 for pre-migration accounts."""
    if not password or not stored_hash:
        return False
    try:
        if stored_hash.startswith('$2'):
            return bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8'))
        # Legacy SHA256 path — accept so existing users can still login
        return hmac.compare_digest(
            hashlib.sha256(password.encode()).hexdigest(), stored_hash
        )
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# JWT helpers — HS256 with jti + iss + role claims
# ---------------------------------------------------------------------------
def _issue_jwt(sub: str, role: str, extra: dict | None = None) -> str:
    now = int(time.time())
    payload: dict = {
        'sub': sub,
        'role': role,
        'jti': uuid.uuid4().hex,
        'iat': now,
        'exp': now + JWT_TTL,
        'iss': JWT_ISSUER,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')


def _decode_jwt(token: str) -> dict | None:
    """Verify signature, expiry, issuer, and revocation list. Returns claims or None."""
    if not token or not isinstance(token, str):
        return None
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=['HS256'], issuer=JWT_ISSUER)
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    if _is_token_revoked(claims.get('jti', '')):
        return None
    return claims


def _extract_token() -> str:
    """Pull JWT from X-Admin-Token (priority) or Authorization: Bearer header."""
    admin_token = request.headers.get('X-Admin-Token', '').strip()
    if admin_token:
        return admin_token
    auth = request.headers.get('Authorization', '') or ''
    if auth.startswith('Bearer '):
        return auth[len('Bearer '):].strip()
    return ''


# ---------------------------------------------------------------------------
# Passkey / WebAuthn helpers
# ---------------------------------------------------------------------------
def _pk_put(data: dict) -> str:
    cid = uuid.uuid4().hex
    now = time.time()
    with _pk_lock:
        stale = [k for k, v in list(_pk_challenges.items()) if v.get('_exp', 0) < now]
        for k in stale:
            del _pk_challenges[k]
        _pk_challenges[cid] = {**data, '_exp': now + 300}
    return cid


def _pk_take(cid: str):
    with _pk_lock:
        c = _pk_challenges.pop(cid, None)
    if not c or c.get('_exp', 0) < time.time():
        return None
    return c


def _passkey_origin() -> str:
    if _PASSKEY_ORIGIN_OVERRIDE:
        return _PASSKEY_ORIGIN_OVERRIDE
    origin = (request.headers.get('Origin') or '').strip()
    if origin:
        return origin
    host = request.headers.get('Host', 'localhost')
    scheme = 'https' if request.is_secure else 'http'
    return f'{scheme}://{host}'



# ---------------------------------------------------------------------------
# IP helper — ProxyFix already resolved remote_addr when TRUST_PROXY=true
# ---------------------------------------------------------------------------
def get_client_ip() -> str:
    return request.remote_addr or '0.0.0.0'


# ---------------------------------------------------------------------------
# Request / response logging
# ---------------------------------------------------------------------------
@app.before_request
def start_request_log():
    g.request_id = uuid.uuid4().hex[:8]
    g.start_time = time.time()
    logger.info('[%s] %s %s ip=%s', g.request_id, request.method, request.path, get_client_ip())


@app.after_request
def add_security_headers(response):
    """Attach security headers and emit the response log line."""
    duration_ms = int((time.time() - g.get('start_time', time.time())) * 1000)
    logger.info('[%s] %s %dms', g.get('request_id', '-'), response.status_code, duration_ms)

    response.headers['X-Request-ID'] = g.get('request_id', '-')
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = (
        'geolocation=(), microphone=(), camera=(), payment=(), usb=()'
    )
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: https:; "
        "connect-src 'self' ws: wss:; "
        "frame-ancestors 'none'; "
        "form-action 'self'; "
        "base-uri 'self'; "
        "object-src 'none';"
    )
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
    return response


def sanitize_input(text):
    """Sanitize user input to prevent injection attacks."""
    if not isinstance(text, str):
        return text
    sanitized = re.sub(r'[^\w\s\-\.,!?\(\)]', '', text)
    return sanitized[:200]


def require_admin(f):
    """Decorator: require a valid admin-role JWT."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = _extract_token()
        if not token:
            return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        payload = _decode_jwt(token)
        if not payload or payload.get('role') != 'admin':
            return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        g.jwt_claims = payload
        return f(*args, **kwargs)
    return decorated


def require_user(f):
    """Decorator: require a valid user-role (or admin) JWT."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = _extract_token()
        if not token:
            return jsonify({'success': False, 'error': 'Authentication required'}), 401
        payload = _decode_jwt(token)
        if not payload or payload.get('role') not in ('user', 'admin'):
            return jsonify({'success': False, 'error': 'Invalid or expired token'}), 401
        g.jwt_claims = payload
        try:
            g.jwt_user_id = int(payload['sub'])
        except (KeyError, ValueError, TypeError):
            return jsonify({'success': False, 'error': 'Invalid token claims'}), 401
        g.jwt_username = payload.get('username', '')
        return f(*args, **kwargs)
    return decorated

# =============================================================================
# Database Connection
# =============================================================================

def get_db():
    """Get database connection for current request."""
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA journal_mode=WAL')
        g.db.execute('PRAGMA foreign_keys=ON')
    return g.db

@app.teardown_appcontext
def close_db(exception):
    """Close database connection at end of request."""
    db = g.pop('db', None)
    if db is not None:
        db.close()

def ensure_tables():
    """Ensure quiz tables exist (for upgrades from older DB)."""
    db = get_db()
    db.executescript('''
        CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            display_name TEXT,
            email TEXT,
            bio TEXT,
            role TEXT,
            organization TEXT,
            phone TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS quiz_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            is_active INTEGER DEFAULT 0,
            time_limit_minutes INTEGER,
            randomize_questions INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS quiz_session_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            category_id INTEGER NOT NULL,
            difficulty TEXT,
            question_limit INTEGER,
            FOREIGN KEY (session_id) REFERENCES quiz_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (category_id) REFERENCES categories(id)
        );
        CREATE TABLE IF NOT EXISTS user_answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_id INTEGER NOT NULL,
            question_id INTEGER NOT NULL,
            selected_answers TEXT NOT NULL,
            is_correct INTEGER NOT NULL,
            time_taken_seconds REAL,
            answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (session_id) REFERENCES quiz_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (question_id) REFERENCES questions(id),
            UNIQUE(user_id, session_id, question_id)
        );
        CREATE TABLE IF NOT EXISTS user_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_id INTEGER NOT NULL,
            total_questions INTEGER NOT NULL DEFAULT 0,
            correct_answers INTEGER NOT NULL DEFAULT 0,
            total_time_seconds REAL,
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (session_id) REFERENCES quiz_sessions(id) ON DELETE CASCADE,
            UNIQUE(user_id, session_id)
        );
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_quiz_sessions_active ON quiz_sessions(is_active);
        CREATE INDEX IF NOT EXISTS idx_user_answers_user ON user_answers(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_answers_session ON user_answers(session_id);
        CREATE INDEX IF NOT EXISTS idx_user_results_user ON user_results(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_results_session ON user_results(session_id);
        CREATE INDEX IF NOT EXISTS idx_user_answers_lookup ON user_answers(user_id, session_id, question_id);
        CREATE INDEX IF NOT EXISTS idx_user_results_lookup ON user_results(user_id, session_id);
        CREATE TABLE IF NOT EXISTS revoked_tokens (
            jti        TEXT PRIMARY KEY,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS passkeys (
            cred_id      TEXT PRIMARY KEY,
            user_id      INTEGER NOT NULL,
            public_key   TEXT NOT NULL,
            sign_count   INTEGER NOT NULL DEFAULT 0,
            transports   TEXT NOT NULL DEFAULT '[]',
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_used_at TIMESTAMP
        );
    ''')
    db.commit()
    # Migrate existing databases: add profile columns if missing
    cols = {row['name'] for row in db.execute("PRAGMA table_info(users)").fetchall()}
    for col, typedef in [('display_name', 'TEXT'), ('email', 'TEXT'), ('bio', 'TEXT'), ('role', 'TEXT'), ('organization', 'TEXT'), ('phone', 'TEXT'), ('avatar_data', 'BLOB'), ('avatar_type', 'TEXT')]:
        if col not in cols:
            db.execute(f'ALTER TABLE users ADD COLUMN {col} {typedef}')
    db.commit()
# App Config Endpoints
# =============================================================================

@app.route('/api/config', methods=['GET'])
def get_config():
    """Get application configuration (public)."""
    try:
        db = get_db()
        ensure_tables()
        row = db.execute("SELECT value FROM app_config WHERE key = 'freeplay'").fetchone()
        freeplay = row['value'] == 'true' if row else FREEPLAY_DEFAULT
        return jsonify({
            'success': True,
            'config': {
                'accountsEnabled': ACCOUNTS_ENABLED,
                'freeplay': freeplay,
                'requireUserPassword': REQUIRE_USER_PASSWORD,
                'appTitle': os.environ.get('APP_TITLE', 'Trivia Quest'),
                'passkeySupport': PASSKEY_SUPPORT,
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    try:
        db = get_db()
        db.execute('SELECT 1')
        return jsonify({'status': 'healthy', 'database': 'connected'})
    except Exception as e:
        return jsonify({'status': 'unhealthy', 'error': str(e)}), 500

# =============================================================================
# Admin Auth
# =============================================================================

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    """Verify admin password and return a signed JWT."""
    data = request.get_json()
    if not data or 'password' not in data:
        return jsonify({'success': False, 'error': 'Password required'}), 400

    ip = get_client_ip()
    if not _login_rate_ok(ip):
        logger.warning('[%s] admin login rate-limited ip=%s', g.get('request_id', '-'), ip)
        return jsonify({'success': False, 'error': 'Too many attempts. Please wait.'}), 429

    if data['password'] == ADMIN_PASSWORD:
        _reset_login_failures(ip)
        token = _issue_jwt('admin', 'admin')
        logger.info('[%s] admin login success ip=%s', g.get('request_id', '-'), ip)
        return jsonify({'success': True, 'token': token})

    _record_login_failure(ip)
    logger.warning('[%s] admin login failed ip=%s', g.get('request_id', '-'), ip)
    return jsonify({'success': False, 'error': 'Invalid password'}), 401

@app.route('/api/admin/config', methods=['GET'])
@require_admin
def get_admin_config():
    """Get full admin configuration."""
    try:
        db = get_db()
        ensure_tables()
        row = db.execute("SELECT value FROM app_config WHERE key = 'freeplay'").fetchone()
        freeplay = row['value'] == 'true' if row else FREEPLAY_DEFAULT
        return jsonify({
            'success': True,
            'config': {
                'accountsEnabled': ACCOUNTS_ENABLED,
                'freeplay': freeplay,
                'requireUserPassword': REQUIRE_USER_PASSWORD,
                'adminPassword': '***',
                'passkeySupport': PASSKEY_SUPPORT,
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/config', methods=['POST'])
@require_admin
def update_admin_config():
    """Update runtime configuration (freeplay toggle)."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No data provided'}), 400
        db = get_db()
        ensure_tables()
        if 'freeplay' in data:
            val = 'true' if data['freeplay'] else 'false'
            db.execute('''
                INSERT INTO app_config (key, value, updated_at) VALUES ('freeplay', ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
            ''', (val, val))
            db.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/questions/all', methods=['GET'])
@require_admin
def get_all_questions_admin():
    """Get all questions for admin preview. Returns full question data."""
    try:
        db = get_db()
        limit = min(int(request.args.get('limit', MAX_QUESTIONS_PER_REQUEST)), MAX_QUESTIONS_PER_REQUEST)
        offset = int(request.args.get('offset', 0))
        search = request.args.get('search', '')
        
        base_query = 'SELECT * FROM questions WHERE 1=1'
        params = []
        
        if search:
            search_term = f'%{sanitize_input(search)}%'
            base_query += ' AND (question LIKE ? OR answers LIKE ? OR incorrect_answers LIKE ? OR description LIKE ? OR subcategory LIKE ?)'
            params.extend([search_term, search_term, search_term, search_term, search_term])
        
        # Get total count
        count_query = f'SELECT COUNT(*) as total FROM ({base_query})'
        total = db.execute(count_query, params).fetchone()['total']
        
        # Get paginated results
        query = base_query + ' ORDER BY id LIMIT ? OFFSET ?'
        params.extend([limit, offset])
        
        cursor = db.execute(query, params)
        
        questions = []
        for row in cursor.fetchall():
            try:
                question_obj = {
                    'id': row['id'],
                    'Category': row['subcategory'] or 'Uncategorized',
                    'Difficulty': row['difficulty'],
                    'Type': row['question_type'],
                    'Question': row['question'],
                    'Answers': json.loads(row['answers']) if row['answers'] else [],
                    'IncorrectAnswers': json.loads(row['incorrect_answers']) if row['incorrect_answers'] else [],
                    'Description': row['description'] or '',
                    'RegEx': row['regex_pattern'] or '',
                    'RegExDescription': row['regex_description'] or ''
                }
                questions.append(question_obj)
            except json.JSONDecodeError:
                continue
        
        return jsonify({
            'success': True,
            'questions': questions,
            'total': total,
            'limit': limit,
            'offset': offset,
            'hasMore': (offset + limit) < total
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =============================================================================
# Categories & Questions (existing)
# =============================================================================

@app.route('/api/categories', methods=['GET'])
def get_categories():
    """Get all available question categories."""
    try:
        db = get_db()
        cursor = db.execute('''
            SELECT id, name, source_file, question_count, created_at
            FROM categories ORDER BY name
        ''')
        
        categories = []
        for row in cursor.fetchall():
            sub_cursor = db.execute('''
                SELECT DISTINCT subcategory, COUNT(*) as count
                FROM questions
                WHERE category_id = ? AND subcategory IS NOT NULL AND subcategory != ''
                GROUP BY subcategory ORDER BY subcategory
            ''', (row['id'],))
            
            subcategories = [
                {'name': sub['subcategory'], 'count': sub['count']}
                for sub in sub_cursor.fetchall()
            ]
            
            categories.append({
                'id': row['id'],
                'name': row['name'],
                'sourceFile': row['source_file'],
                'questionCount': row['question_count'],
                'subcategories': subcategories
            })
        
        return jsonify({
            'success': True,
            'categories': categories,
            'totalCategories': len(categories)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/categories/<int:category_id>/questions', methods=['GET'])
def get_category_questions(category_id):
    """Get all questions for a specific category."""
    try:
        if category_id < 1 or category_id > 10000:
            return jsonify({'success': False, 'error': 'Invalid category ID'}), 400
        
        subcategory = request.args.get('subcategory', '')
        difficulty = request.args.get('difficulty', '')
        limit = min(int(request.args.get('limit', MAX_QUESTIONS_PER_REQUEST)), MAX_QUESTIONS_PER_REQUEST)
        
        db = get_db()
        cat_cursor = db.execute('SELECT name FROM categories WHERE id = ?', (category_id,))
        cat_row = cat_cursor.fetchone()
        if not cat_row:
            return jsonify({'success': False, 'error': 'Category not found'}), 404
        
        query = 'SELECT * FROM questions WHERE category_id = ?'
        params = [category_id]
        
        if subcategory:
            subcategory = sanitize_input(subcategory)
            query += ' AND subcategory = ?'
            params.append(subcategory)
        
        if difficulty and difficulty in ('L1', 'L2', 'L3', 'L4', 'L5'):
            query += ' AND difficulty = ?'
            params.append(difficulty)
        
        query += ' LIMIT ?'
        params.append(limit)
        
        cursor = db.execute(query, params)
        
        questions = []
        for row in cursor.fetchall():
            question_obj = {
                'id': row['id'],
                'Category': row['subcategory'] or cat_row['name'],
                'Difficulty': row['difficulty'],
                'Question': row['question'],
                'Answers': json.loads(row['answers']),
                'IncorrectAnswers': json.loads(row['incorrect_answers']),
                'Type': row['question_type'] if 'question_type' in row.keys() else 'multiple_choice',
                'Description': row['description'] if 'description' in row.keys() else '',
                'RegEx': row['regex_pattern'] if 'regex_pattern' in row.keys() else '',
                'RegExDescription': row['regex_description'] if 'regex_description' in row.keys() else ''
            }
            questions.append(question_obj)
        
        return jsonify({
            'success': True,
            'categoryName': cat_row['name'],
            'questions': questions,
            'count': len(questions)
        })
    except ValueError:
        return jsonify({'success': False, 'error': 'Invalid parameters'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get database statistics."""
    try:
        db = get_db()
        cat_count = db.execute('SELECT COUNT(*) FROM categories').fetchone()[0]
        q_count = db.execute('SELECT COUNT(*) FROM questions').fetchone()[0]
        
        diff_cursor = db.execute('''
            SELECT difficulty, COUNT(*) as count FROM questions GROUP BY difficulty
        ''')
        difficulties = {row['difficulty']: row['count'] for row in diff_cursor.fetchall()}
        
        return jsonify({
            'success': True,
            'stats': {
                'totalCategories': cat_count,
                'totalQuestions': q_count,
                'difficulties': difficulties
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =============================================================================
# User Registration & Login
# =============================================================================

@app.route('/api/register', methods=['POST'])
def register_user():
    """Register a new user. Disabled when ACCOUNTS_ENABLED=false."""
    if not ACCOUNTS_ENABLED:
        return jsonify({'success': False, 'error': 'User accounts are disabled on this instance'}), 404
    try:
        ip = get_client_ip()
        _record_register_attempt(ip)
        if not _register_rate_ok(ip):
            return jsonify({'success': False, 'error': 'Too many registrations. Please try again later.'}), 429

        data = request.get_json()
        if not data or 'username' not in data:
            return jsonify({'success': False, 'error': 'Username required'}), 400

        username = (data.get('username') or '').strip()
        err = _validate_username(username)
        if err:
            return jsonify({'success': False, 'error': err}), 400

        db = get_db()
        ensure_tables()

        password_hash = None
        if REQUIRE_USER_PASSWORD:
            password = data.get('password', '')
            err = _validate_password(password)
            if err:
                return jsonify({'success': False, 'error': err}), 400
            password_hash = _hash_password(password)

        try:
            db.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)',
                      (username, password_hash))
            db.commit()
            user = db.execute(
                'SELECT id, username, display_name, email, bio FROM users WHERE username = ?',
                (username,)
            ).fetchone()
            token = _issue_jwt(str(user['id']), 'user', {'username': user['username']})
            logger.info('[%s] user registered username=%s ip=%s', g.get('request_id', '-'), username, ip)
            return jsonify({
                'success': True,
                'token': token,
                'user': {
                    'id': user['id'],
                    'username': user['username'],
                    'displayName': user['display_name'] or '',
                    'email': user['email'] or '',
                    'bio': user['bio'] or ''
                }
            })
        except sqlite3.IntegrityError:
            return jsonify({'success': False, 'error': 'Username already taken'}), 409
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/login', methods=['POST'])
def login_user():
    """Login existing user. Disabled when ACCOUNTS_ENABLED=false."""
    if not ACCOUNTS_ENABLED:
        return jsonify({'success': False, 'error': 'User accounts are disabled on this instance'}), 404
    try:
        ip = get_client_ip()
        if not _login_rate_ok(ip):
            return jsonify({'success': False, 'error': 'Too many attempts. Please wait.'}), 429

        data = request.get_json()
        if not data or 'username' not in data:
            return jsonify({'success': False, 'error': 'Username required'}), 400

        username = (data.get('username') or '').strip()
        db = get_db()
        ensure_tables()

        user = db.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()

        if REQUIRE_USER_PASSWORD:
            password = data.get('password', '')
            # Timing guard: always run a verify even if user doesn't exist
            if user is None:
                _hash_password('timing~guard~placeholder')
                _record_login_failure(ip)
                return jsonify({'success': False, 'error': 'Invalid username or password'}), 401
            if not _verify_password(password, user['password_hash'] or ''):
                _record_login_failure(ip)
                logger.warning('[%s] user login failed username=%s ip=%s', g.get('request_id', '-'), username, ip)
                return jsonify({'success': False, 'error': 'Invalid username or password'}), 401
            # Re-hash legacy SHA256 passwords with bcrypt on successful login
            if user['password_hash'] and not user['password_hash'].startswith('$2'):
                new_hash = _hash_password(password)
                db.execute('UPDATE users SET password_hash = ? WHERE id = ?', (new_hash, user['id']))
                db.commit()
        elif user is None:
            return jsonify({'success': False, 'error': 'User not found'})

        _reset_login_failures(ip)
        token = _issue_jwt(str(user['id']), 'user', {'username': user['username']})
        logger.info('[%s] user login success username=%s ip=%s', g.get('request_id', '-'), username, ip)
        return jsonify({
            'success': True,
            'token': token,
            'user': {
                'id': user['id'],
                'username': user['username'],
                'displayName': user['display_name'] or '' if 'display_name' in user.keys() else '',
                'email': user['email'] or '' if 'email' in user.keys() else '',
                'bio': user['bio'] or '' if 'bio' in user.keys() else ''
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =============================================================================
# User Profile
# =============================================================================

@app.route('/api/user/profile', methods=['GET'])
def get_user_profile():
    """Get user profile by userId query param."""
    try:
        user_id = request.args.get('userId')
        if not user_id:
            return jsonify({'success': False, 'error': 'userId required'}), 400
        
        db = get_db()
        ensure_tables()
        
        user = db.execute('''
            SELECT u.id, u.username, u.display_name, u.email, u.bio, u.role, u.organization, u.phone, u.created_at,
                   (SELECT COUNT(*) FROM user_results ur WHERE ur.user_id = u.id) as quiz_count,
                   (SELECT AVG(ur.correct_answers * 100.0 / ur.total_questions) FROM user_results ur WHERE ur.user_id = u.id AND ur.total_questions > 0) as avg_score,
                   (SELECT MAX(ur.completed_at) FROM user_results ur WHERE ur.user_id = u.id) as last_active
            FROM users u WHERE u.id = ?
        ''', (user_id,)).fetchone()
        
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        return jsonify({
            'success': True,
            'profile': {
                'id': user['id'],
                'username': user['username'],
                'displayName': user['display_name'] or '',
                'email': user['email'] or '',
                'bio': user['bio'] or '',
                'role': user['role'] or '',
                'organization': user['organization'] or '',
                'phone': user['phone'] or '',
                'createdAt': user['created_at'],
                'quizCount': user['quiz_count'],
                'avgScore': round(user['avg_score'], 1) if user['avg_score'] else 0,
                'lastActive': user['last_active']
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/user/profile', methods=['PUT'])
def update_user_profile():
    """Update own profile (display_name, email, bio)."""
    try:
        data = request.get_json()
        if not data or 'userId' not in data:
            return jsonify({'success': False, 'error': 'userId required'}), 400
        
        user_id = data['userId']
        db = get_db()
        ensure_tables()
        
        user = db.execute('SELECT id FROM users WHERE id = ?', (user_id,)).fetchone()
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        display_name = data.get('displayName', '').strip()[:50]
        email = data.get('email', '').strip()[:100]
        bio = data.get('bio', '').strip()[:200]
        role = data.get('role', '').strip()[:50]
        organization = data.get('organization', '').strip()[:100]
        phone = data.get('phone', '').strip()[:30]
        
        db.execute('UPDATE users SET display_name = ?, email = ?, bio = ?, role = ?, organization = ?, phone = ? WHERE id = ?',
                  (display_name or None, email or None, bio or None, role or None, organization or None, phone or None, user_id))
        db.commit()
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/sessions', methods=['GET'])
@require_admin
def list_sessions():
    """List all quiz sessions."""
    try:
        db = get_db()
        ensure_tables()
        
        sessions = db.execute('''
            SELECT qs.*, 
                   (SELECT COUNT(DISTINCT ua.user_id) FROM user_answers ua WHERE ua.session_id = qs.id) as participant_count
            FROM quiz_sessions qs
            ORDER BY qs.created_at DESC
        ''').fetchall()
        
        result = []
        for s in sessions:
            cats = db.execute('''
                SELECT qsc.*, c.name as category_name, c.question_count
                FROM quiz_session_categories qsc
                JOIN categories c ON c.id = qsc.category_id
                WHERE qsc.session_id = ?
            ''', (s['id'],)).fetchall()
            
            result.append({
                'id': s['id'],
                'name': s['name'],
                'description': s['description'],
                'isActive': bool(s['is_active']),
                'timeLimitMinutes': s['time_limit_minutes'],
                'randomizeQuestions': bool(s['randomize_questions']),
                'participantCount': s['participant_count'],
                'createdAt': s['created_at'],
                'categories': [{
                    'categoryId': c['category_id'],
                    'categoryName': c['category_name'],
                    'difficulty': c['difficulty'],
                    'questionLimit': c['question_limit'],
                    'totalAvailable': c['question_count']
                } for c in cats]
            })
        
        return jsonify({'success': True, 'sessions': result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/sessions', methods=['POST'])
@require_admin
def create_session():
    """Create a new quiz session."""
    try:
        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({'success': False, 'error': 'Session name required'}), 400
        
        db = get_db()
        ensure_tables()
        
        cursor = db.execute('''
            INSERT INTO quiz_sessions (name, description, time_limit_minutes, randomize_questions)
            VALUES (?, ?, ?, ?)
        ''', (
            data['name'],
            data.get('description', ''),
            data.get('timeLimitMinutes'),
            1 if data.get('randomizeQuestions') else 0
        ))
        session_id = cursor.lastrowid
        
        categories = data.get('categories', [])
        for cat in categories:
            db.execute('''
                INSERT INTO quiz_session_categories (session_id, category_id, difficulty, question_limit)
                VALUES (?, ?, ?, ?)
            ''', (session_id, cat['categoryId'], cat.get('difficulty'), cat.get('questionLimit')))
        
        db.commit()
        return jsonify({'success': True, 'sessionId': session_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/sessions/<int:session_id>', methods=['PUT'])
@require_admin
def update_session(session_id):
    """Update a quiz session."""
    try:
        data = request.get_json()
        db = get_db()
        ensure_tables()
        
        session = db.execute('SELECT * FROM quiz_sessions WHERE id = ?', (session_id,)).fetchone()
        if not session:
            return jsonify({'success': False, 'error': 'Session not found'}), 404
        
        db.execute('''
            UPDATE quiz_sessions
            SET name = ?, description = ?, time_limit_minutes = ?, randomize_questions = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (
            data.get('name', session['name']),
            data.get('description', session['description']),
            data.get('timeLimitMinutes', session['time_limit_minutes']),
            1 if data.get('randomizeQuestions', session['randomize_questions']) else 0,
            session_id
        ))
        
        if 'categories' in data:
            db.execute('DELETE FROM quiz_session_categories WHERE session_id = ?', (session_id,))
            for cat in data['categories']:
                db.execute('''
                    INSERT INTO quiz_session_categories (session_id, category_id, difficulty, question_limit)
                    VALUES (?, ?, ?, ?)
                ''', (session_id, cat['categoryId'], cat.get('difficulty'), cat.get('questionLimit')))
        
        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/sessions/<int:session_id>', methods=['DELETE'])
@require_admin
def delete_session(session_id):
    """Delete a quiz session and all related data."""
    try:
        db = get_db()
        db.execute('DELETE FROM quiz_sessions WHERE id = ?', (session_id,))
        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/sessions/<int:session_id>/activate', methods=['POST'])
@require_admin
def activate_session(session_id):
    """Activate a quiz session (deactivates all others)."""
    try:
        db = get_db()
        ensure_tables()
        
        session = db.execute('SELECT * FROM quiz_sessions WHERE id = ?', (session_id,)).fetchone()
        if not session:
            return jsonify({'success': False, 'error': 'Session not found'}), 404
        
        db.execute('UPDATE quiz_sessions SET is_active = 0')
        db.execute('UPDATE quiz_sessions SET is_active = 1 WHERE id = ?', (session_id,))
        db.commit()
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/sessions/<int:session_id>/deactivate', methods=['POST'])
@require_admin
def deactivate_session(session_id):
    """Deactivate a quiz session."""
    try:
        db = get_db()
        db.execute('UPDATE quiz_sessions SET is_active = 0 WHERE id = ?', (session_id,))
        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =============================================================================
# Active Quiz Session (User-facing)
# =============================================================================

@app.route('/api/session/active', methods=['GET'])
def get_active_session():
    """Get the currently active quiz session with questions."""
    try:
        db = get_db()
        ensure_tables()
        
        session = db.execute('SELECT * FROM quiz_sessions WHERE is_active = 1').fetchone()
        if not session:
            return jsonify({'success': True, 'session': None})
        
        cats = db.execute('''
            SELECT qsc.*, c.name as category_name
            FROM quiz_session_categories qsc
            JOIN categories c ON c.id = qsc.category_id
            WHERE qsc.session_id = ?
        ''', (session['id'],)).fetchall()
        
        questions = []
        for cat in cats:
            query = 'SELECT * FROM questions WHERE category_id = ?'
            params = [cat['category_id']]
            
            if cat['difficulty']:
                query += ' AND difficulty = ?'
                params.append(cat['difficulty'])
            
            if cat['question_limit']:
                query += ' LIMIT ?'
                params.append(cat['question_limit'])
            
            rows = db.execute(query, params).fetchall()
            for row in rows:
                questions.append({
                    'id': row['id'],
                    'Category': row['subcategory'] or cat['category_name'],
                    'Difficulty': row['difficulty'],
                    'Question': row['question'],
                    'Answers': json.loads(row['answers']),
                    'IncorrectAnswers': json.loads(row['incorrect_answers']),
                    'Type': row['question_type'],
                    'Description': row['description'] or '',
                    'RegEx': row['regex_pattern'] or '',
                    'RegExDescription': row['regex_description'] or ''
                })
        
        return jsonify({
            'success': True,
            'session': {
                'id': session['id'],
                'name': session['name'],
                'description': session['description'],
                'timeLimitMinutes': session['time_limit_minutes'],
                'randomizeQuestions': bool(session['randomize_questions']),
                'questions': questions,
                'totalQuestions': len(questions)
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/session/active/progress/<int:user_id>', methods=['GET'])
def get_user_progress(user_id):
    """Get user's progress in the active session."""
    try:
        db = get_db()
        ensure_tables()
        
        session = db.execute('SELECT * FROM quiz_sessions WHERE is_active = 1').fetchone()
        if not session:
            return jsonify({'success': True, 'progress': None})
        
        answers = db.execute('''
            SELECT question_id, is_correct FROM user_answers
            WHERE user_id = ? AND session_id = ?
        ''', (user_id, session['id'])).fetchall()
        
        answered_ids = [a['question_id'] for a in answers]
        correct_count = sum(1 for a in answers if a['is_correct'])
        
        return jsonify({
            'success': True,
            'progress': {
                'sessionId': session['id'],
                'answeredQuestions': answered_ids,
                'totalAnswered': len(answers),
                'correctAnswers': correct_count
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =============================================================================
# Answer Submission
# =============================================================================

@app.route('/api/answer', methods=['POST'])
@require_user
def submit_answer():
    """Submit a single answer. Called after each question."""
    try:
        data = request.get_json()
        required = ['userId', 'sessionId', 'questionId', 'selectedAnswers']
        if not data or not all(k in data for k in required):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400

        # Enforce that the JWT user matches the submitted userId
        if int(data['userId']) != g.jwt_user_id:
            return jsonify({'success': False, 'error': 'Forbidden'}), 403
        
        db = get_db()
        ensure_tables()
        
        user = db.execute('SELECT id FROM users WHERE id = ?', (data['userId'],)).fetchone()
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        # Look up the question and validate server-side
        question = db.execute(
            'SELECT answers, question_type, regex_pattern FROM questions WHERE id = ?',
            (data['questionId'],)
        ).fetchone()
        if not question:
            return jsonify({'success': False, 'error': 'Question not found'}), 404
        
        is_correct = _validate_answer(question, data['selectedAnswers'])
        
        # Use INSERT OR IGNORE to avoid race-condition duplicates
        cursor = db.execute('''
            INSERT OR IGNORE INTO user_answers (user_id, session_id, question_id, selected_answers, is_correct, time_taken_seconds)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            data['userId'],
            data['sessionId'],
            data['questionId'],
            json.dumps(data['selectedAnswers']),
            1 if is_correct else 0,
            data.get('timeTakenSeconds')
        ))
        db.commit()
        
        if cursor.rowcount == 0:
            return jsonify({'success': True, 'message': 'Answer already recorded', 'duplicate': True})
        
        return jsonify({'success': True, 'isCorrect': is_correct})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


def _validate_answer(question, selected_answers):
    """Validate the user's answer server-side against the stored correct answer."""
    q_type = question['question_type']
    correct_raw = json.loads(question['answers'])

    if q_type == 'hidden':
        # Informational — always "correct"
        return True

    if q_type == 'general' and question['regex_pattern']:
        # Any selected answer that matches the regex is correct
        pattern = question['regex_pattern']
        try:
            for ans in (selected_answers if isinstance(selected_answers, list) else [selected_answers]):
                if re.fullmatch(pattern, str(ans), re.IGNORECASE):
                    return True
        except re.error:
            pass
        return False

    # multiple_choice or multiple_answer: compare answer sets
    correct_set = {str(a).strip().lower() for a in correct_raw}
    selected_set = {str(a).strip().lower() for a in (selected_answers if isinstance(selected_answers, list) else [selected_answers])}
    return correct_set == selected_set

@app.route('/api/quiz/complete', methods=['POST'])
@require_user
def complete_quiz():
    """Mark a quiz as completed for a user."""
    try:
        data = request.get_json()
        required = ['userId', 'sessionId']
        if not data or not all(k in data for k in required):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400

        if int(data['userId']) != g.jwt_user_id:
            return jsonify({'success': False, 'error': 'Forbidden'}), 403
        
        db = get_db()
        ensure_tables()
        
        stats = db.execute('''
            SELECT COUNT(*) as total, SUM(is_correct) as correct, SUM(time_taken_seconds) as total_time
            FROM user_answers
            WHERE user_id = ? AND session_id = ?
        ''', (data['userId'], data['sessionId'])).fetchone()
        
        db.execute('''
            INSERT INTO user_results (user_id, session_id, total_questions, correct_answers, total_time_seconds)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, session_id) DO UPDATE SET
                total_questions = excluded.total_questions,
                correct_answers = excluded.correct_answers,
                total_time_seconds = excluded.total_time_seconds,
                completed_at = CURRENT_TIMESTAMP
        ''', (data['userId'], data['sessionId'], stats['total'], stats['correct'] or 0, stats['total_time']))
        
        db.commit()
        
        return jsonify({
            'success': True,
            'result': {
                'totalQuestions': stats['total'],
                'correctAnswers': stats['correct'] or 0,
                'totalTimeSeconds': stats['total_time'],
                'percentage': round((stats['correct'] or 0) / max(stats['total'], 1) * 100, 1)
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/my-answers', methods=['GET'])
def get_my_answers():
    """Get a user's own answers for a session (non-admin)."""
    try:
        user_id = request.args.get('userId')
        session_id = request.args.get('sessionId')
        if not user_id or not session_id:
            return jsonify({'success': False, 'error': 'userId and sessionId required'}), 400
        
        db = get_db()
        ensure_tables()
        
        rows = db.execute('''
            SELECT ua.question_id, ua.selected_answers, ua.is_correct, ua.time_taken_seconds,
                   q.question, q.answers as correct_answers, q.question_type,
                   q.subcategory as category, q.difficulty
            FROM user_answers ua
            JOIN questions q ON q.id = ua.question_id
            WHERE ua.user_id = ? AND ua.session_id = ?
            ORDER BY ua.answered_at
        ''', (int(user_id), int(session_id))).fetchall()
        
        return jsonify({
            'success': True,
            'answers': [{
                'question': r['question'],
                'category': r['category'],
                'difficulty': r['difficulty'],
                'selectedAnswers': json.loads(r['selected_answers']),
                'correctAnswers': json.loads(r['correct_answers']),
                'isCorrect': bool(r['is_correct']),
                'timeTakenSeconds': r['time_taken_seconds']
            } for r in rows]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =============================================================================
# Admin Activity (Live Progress)
# =============================================================================

@app.route('/api/admin/activity', methods=['GET'])
@require_admin
def get_activity():
    """Get in-progress quiz activity — users with answers but no completion."""
    try:
        db = get_db()
        ensure_tables()
        
        rows = db.execute('''
            SELECT u.id as user_id, u.username, ua.session_id, qs.name as session_name,
                   COUNT(*) as answers_count,
                   SUM(ua.is_correct) as correct_count,
                   MAX(ua.answered_at) as last_answer_at
            FROM user_answers ua
            JOIN users u ON u.id = ua.user_id
            JOIN quiz_sessions qs ON qs.id = ua.session_id
            LEFT JOIN user_results ur ON ur.user_id = ua.user_id AND ur.session_id = ua.session_id
            WHERE ur.id IS NULL
            GROUP BY ua.user_id, ua.session_id
            ORDER BY MAX(ua.answered_at) DESC
        ''').fetchall()
        
        return jsonify({
            'success': True,
            'activity': [{
                'userId': r['user_id'],
                'username': r['username'],
                'sessionId': r['session_id'],
                'sessionName': r['session_name'],
                'answersCount': r['answers_count'],
                'correctCount': r['correct_count'] or 0,
                'lastAnswerAt': r['last_answer_at']
            } for r in rows]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =============================================================================
# Admin Results & Analytics
# =============================================================================

@app.route('/api/admin/results', methods=['GET'])
@require_admin
def get_results():
    """Get quiz results with optional filters."""
    try:
        db = get_db()
        ensure_tables()
        
        session_id = request.args.get('sessionId')
        user_id = request.args.get('userId')
        
        query = '''
            SELECT ur.*, u.username, qs.name as session_name
            FROM user_results ur
            JOIN users u ON u.id = ur.user_id
            JOIN quiz_sessions qs ON qs.id = ur.session_id
            WHERE 1=1
        '''
        params = []
        
        if session_id:
            query += ' AND ur.session_id = ?'
            params.append(int(session_id))
        if user_id:
            query += ' AND ur.user_id = ?'
            params.append(int(user_id))
        
        query += ' ORDER BY ur.completed_at DESC'
        
        rows = db.execute(query, params).fetchall()
        
        results = [{
            'id': r['id'],
            'userId': r['user_id'],
            'username': r['username'],
            'sessionId': r['session_id'],
            'sessionName': r['session_name'],
            'totalQuestions': r['total_questions'],
            'correctAnswers': r['correct_answers'],
            'totalTimeSeconds': r['total_time_seconds'],
            'percentage': round(r['correct_answers'] / max(r['total_questions'], 1) * 100, 1),
            'completedAt': r['completed_at']
        } for r in rows]
        
        return jsonify({'success': True, 'results': results})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/results/<int:user_id>/answers', methods=['GET'])
@require_admin
def get_user_answers(user_id):
    """Get individual user answers for a session."""
    try:
        session_id = request.args.get('sessionId')
        if not session_id:
            return jsonify({'success': False, 'error': 'sessionId required'}), 400
        
        db = get_db()
        ensure_tables()
        
        user = db.execute('SELECT username FROM users WHERE id = ?', (user_id,)).fetchone()
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        rows = db.execute('''
            SELECT ua.*, q.question, q.answers as correct_answers, q.question_type, 
                   q.subcategory, q.difficulty
            FROM user_answers ua
            JOIN questions q ON q.id = ua.question_id
            WHERE ua.user_id = ? AND ua.session_id = ?
            ORDER BY ua.answered_at
        ''', (user_id, int(session_id))).fetchall()
        
        answers = [{
            'questionId': a['question_id'],
            'question': a['question'],
            'questionType': a['question_type'],
            'category': a['subcategory'],
            'difficulty': a['difficulty'],
            'selectedAnswers': json.loads(a['selected_answers']),
            'correctAnswers': json.loads(a['correct_answers']),
            'isCorrect': bool(a['is_correct']),
            'timeTakenSeconds': a['time_taken_seconds'],
            'answeredAt': a['answered_at']
        } for a in rows]
        
        return jsonify({
            'success': True,
            'username': user['username'],
            'answers': answers
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/results/summary', methods=['GET'])
@require_admin
def get_results_summary():
    """Get aggregated results for charts/graphs."""
    try:
        session_id = request.args.get('sessionId')
        db = get_db()
        ensure_tables()
        
        data = {}
        
        query = '''
            SELECT u.username, ur.correct_answers, ur.total_questions, ur.total_time_seconds
            FROM user_results ur
            JOIN users u ON u.id = ur.user_id
        '''
        params = []
        if session_id:
            query += ' WHERE ur.session_id = ?'
            params.append(int(session_id))
        query += ' ORDER BY ur.correct_answers DESC'
        
        users = db.execute(query, params).fetchall()
        data['userScores'] = [{
            'username': u['username'],
            'correct': u['correct_answers'],
            'total': u['total_questions'],
            'percentage': round(u['correct_answers'] / max(u['total_questions'], 1) * 100, 1),
            'timeSeconds': u['total_time_seconds']
        } for u in users]
        
        cat_query = '''
            SELECT q.subcategory as category, 
                   COUNT(*) as total,
                   SUM(ua.is_correct) as correct
            FROM user_answers ua
            JOIN questions q ON q.id = ua.question_id
        '''
        cat_params = []
        if session_id:
            cat_query += ' WHERE ua.session_id = ?'
            cat_params.append(int(session_id))
        cat_query += ' GROUP BY q.subcategory ORDER BY category'
        
        cats = db.execute(cat_query, cat_params).fetchall()
        data['categoryAccuracy'] = [{
            'category': c['category'] or 'General',
            'total': c['total'],
            'correct': c['correct'] or 0,
            'percentage': round((c['correct'] or 0) / max(c['total'], 1) * 100, 1)
        } for c in cats]
        
        diff_query = '''
            SELECT q.difficulty,
                   COUNT(*) as total,
                   SUM(ua.is_correct) as correct
            FROM user_answers ua
            JOIN questions q ON q.id = ua.question_id
        '''
        diff_params = []
        if session_id:
            diff_query += ' WHERE ua.session_id = ?'
            diff_params.append(int(session_id))
        diff_query += ' GROUP BY q.difficulty ORDER BY q.difficulty'
        
        diffs = db.execute(diff_query, diff_params).fetchall()
        data['difficultyAccuracy'] = [{
            'difficulty': d['difficulty'],
            'total': d['total'],
            'correct': d['correct'] or 0,
            'percentage': round((d['correct'] or 0) / max(d['total'], 1) * 100, 1)
        } for d in diffs]
        
        data['totalParticipants'] = len(users)
        data['averageScore'] = round(
            sum(u['correct_answers'] for u in users) / max(len(users), 1), 1
        ) if users else 0
        
        return jsonify({'success': True, 'summary': data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/results/export', methods=['GET'])
@require_admin
def export_results():
    """Export results as CSV."""
    try:
        session_id = request.args.get('sessionId')
        user_id = request.args.get('userId')
        export_type = request.args.get('type', 'summary')
        
        db = get_db()
        ensure_tables()
        
        output = io.StringIO()
        writer = csv.writer(output)
        
        if export_type == 'detailed':
            writer.writerow(['Username', 'Session', 'Question', 'Category', 'Difficulty',
                           'Selected Answers', 'Correct Answers', 'Is Correct', 'Time (s)', 'Answered At'])
            
            query = '''
                SELECT u.username, qs.name as session_name, q.question, q.subcategory, q.difficulty,
                       ua.selected_answers, q.answers as correct_answers, ua.is_correct,
                       ua.time_taken_seconds, ua.answered_at
                FROM user_answers ua
                JOIN users u ON u.id = ua.user_id
                JOIN quiz_sessions qs ON qs.id = ua.session_id
                JOIN questions q ON q.id = ua.question_id
                WHERE 1=1
            '''
            params = []
            if session_id:
                query += ' AND ua.session_id = ?'
                params.append(int(session_id))
            if user_id:
                query += ' AND ua.user_id = ?'
                params.append(int(user_id))
            query += ' ORDER BY u.username, ua.answered_at'
            
            rows = db.execute(query, params).fetchall()
            for r in rows:
                writer.writerow([
                    r['username'], r['session_name'], r['question'], r['subcategory'],
                    r['difficulty'], r['selected_answers'], r['correct_answers'],
                    'Yes' if r['is_correct'] else 'No', r['time_taken_seconds'], r['answered_at']
                ])
        else:
            writer.writerow(['Username', 'Session', 'Total Questions', 'Correct', 'Percentage', 'Time (s)', 'Completed At'])
            
            query = '''
                SELECT u.username, qs.name as session_name, ur.total_questions, ur.correct_answers,
                       ur.total_time_seconds, ur.completed_at
                FROM user_results ur
                JOIN users u ON u.id = ur.user_id
                JOIN quiz_sessions qs ON qs.id = ur.session_id
                WHERE 1=1
            '''
            params = []
            if session_id:
                query += ' AND ur.session_id = ?'
                params.append(int(session_id))
            if user_id:
                query += ' AND ur.user_id = ?'
                params.append(int(user_id))
            query += ' ORDER BY ur.completed_at DESC'
            
            rows = db.execute(query, params).fetchall()
            for r in rows:
                pct = round(r['correct_answers'] / max(r['total_questions'], 1) * 100, 1)
                writer.writerow([
                    r['username'], r['session_name'], r['total_questions'], r['correct_answers'],
                    f'{pct}%', r['total_time_seconds'], r['completed_at']
                ])
        
        output.seek(0)
        filename = f'trivia-results-{datetime.now().strftime("%Y%m%d-%H%M%S")}.csv'
        
        return Response(
            output.getvalue(),
            mimetype='text/csv',
            headers={'Content-Disposition': f'attachment; filename={filename}'}
        )
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =============================================================================
# Admin User Management
# =============================================================================

@app.route('/api/admin/users', methods=['GET'])
@require_admin
def list_users():
    """List all registered users."""
    try:
        db = get_db()
        ensure_tables()
        
        users = db.execute('''
            SELECT u.id, u.username, u.display_name, u.email, u.bio, u.role, u.organization, u.phone, u.created_at,
                   (SELECT COUNT(*) FROM user_results ur WHERE ur.user_id = u.id) as quiz_count,
                   (SELECT AVG(ur.correct_answers * 100.0 / ur.total_questions) FROM user_results ur WHERE ur.user_id = u.id AND ur.total_questions > 0) as avg_score,
                   (SELECT MAX(ur.completed_at) FROM user_results ur WHERE ur.user_id = u.id) as last_active
            FROM users u ORDER BY u.created_at DESC
        ''').fetchall()
        
        return jsonify({
            'success': True,
            'users': [{
                'id': u['id'],
                'username': u['username'],
                'displayName': u['display_name'] or '',
                'email': u['email'] or '',
                'bio': u['bio'] or '',
                'role': u['role'] or '',
                'organization': u['organization'] or '',
                'phone': u['phone'] or '',
                'createdAt': u['created_at'],
                'quizCount': u['quiz_count'],
                'avgScore': round(u['avg_score'], 1) if u['avg_score'] else 0,
                'lastActive': u['last_active']
            } for u in users]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/admin/users', methods=['POST'])
@require_admin
def create_user():
    """Admin: create a new user account directly."""
    try:
        data = request.get_json()
        if not data or 'username' not in data:
            return jsonify({'success': False, 'error': 'Username required'}), 400

        username = (data.get('username') or '').strip()
        err = _validate_username(username)
        if err:
            return jsonify({'success': False, 'error': err}), 400

        db = get_db()
        ensure_tables()

        password_hash = None
        if data.get('password'):
            err = _validate_password(data['password'])
            if err:
                return jsonify({'success': False, 'error': err}), 400
            password_hash = _hash_password(data['password'])
        elif REQUIRE_USER_PASSWORD:
            return jsonify({'success': False, 'error': 'Password required (REQUIRE_USER_PASSWORD is enabled)'}), 400

        display_name = (data.get('displayName') or '').strip()[:50] or None
        email = (data.get('email') or '').strip()[:100] or None
        bio = (data.get('bio') or '').strip()[:200] or None
        role = (data.get('role') or '').strip()[:50] or None
        organization = (data.get('organization') or '').strip()[:100] or None
        phone = (data.get('phone') or '').strip()[:30] or None

        try:
            db.execute(
                'INSERT INTO users (username, password_hash, display_name, email, bio, role, organization, phone)'
                ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                (username, password_hash, display_name, email, bio, role, organization, phone)
            )
            db.commit()
            user = db.execute('SELECT id, username FROM users WHERE username = ?', (username,)).fetchone()
            logger.info('[%s] admin created user username=%s', g.get('request_id', '-'), username)
            return jsonify({'success': True, 'userId': user['id'], 'username': user['username']})
        except sqlite3.IntegrityError:
            return jsonify({'success': False, 'error': 'Username already taken'}), 409
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@require_admin
def delete_user(user_id):
    """Delete a user and their data."""
    try:
        db = get_db()
        db.execute('DELETE FROM user_answers WHERE user_id = ?', (user_id,))
        db.execute('DELETE FROM user_results WHERE user_id = ?', (user_id,))
        db.execute('DELETE FROM users WHERE id = ?', (user_id,))
        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/users/<int:user_id>', methods=['PUT'])
@require_admin
def update_user(user_id):
    """Admin: update any user's profile and username."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No data provided'}), 400
        
        db = get_db()
        ensure_tables()
        
        user = db.execute('SELECT id FROM users WHERE id = ?', (user_id,)).fetchone()
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        
        updates = []
        params = []
        
        if 'username' in data:
            username = data['username'].strip()
            if not username or len(username) < 2 or len(username) > 30:
                return jsonify({'success': False, 'error': 'Username must be 2-30 characters'}), 400
            if not re.match(r'^[\w\s\-]+$', username):
                return jsonify({'success': False, 'error': 'Username contains invalid characters'}), 400
            existing = db.execute('SELECT id FROM users WHERE username = ? AND id != ?', (username, user_id)).fetchone()
            if existing:
                return jsonify({'success': False, 'error': 'Username already taken'}), 409
            updates.append('username = ?')
            params.append(username)
        
        if 'displayName' in data:
            updates.append('display_name = ?')
            params.append(data['displayName'].strip()[:50] or None)
        if 'email' in data:
            updates.append('email = ?')
            params.append(data['email'].strip()[:100] or None)
        if 'bio' in data:
            updates.append('bio = ?')
            params.append(data['bio'].strip()[:200] or None)
        if 'role' in data:
            updates.append('role = ?')
            params.append(data['role'].strip()[:50] or None)
        if 'organization' in data:
            updates.append('organization = ?')
            params.append(data['organization'].strip()[:100] or None)
        if 'phone' in data:
            updates.append('phone = ?')
            params.append(data['phone'].strip()[:30] or None)
        if 'password' in data and data['password']:
            err = _validate_password(data['password'])
            if err:
                return jsonify({'success': False, 'error': err}), 400
            updates.append('password_hash = ?')
            params.append(_hash_password(data['password']))
        
        if not updates:
            return jsonify({'success': False, 'error': 'No fields to update'}), 400
        
        params.append(user_id)
        db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
        db.commit()
        
        return jsonify({'success': True})
    except sqlite3.IntegrityError:
        return jsonify({'success': False, 'error': 'Username already taken'}), 409
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# =============================================================================
# File Upload Security
# =============================================================================

ALLOWED_UPLOAD_MIMES = {
    'application/json',
    'application/jsonlines',
    'text/plain',
    'text/csv',
    'application/octet-stream',  # fallback for .jsonl files
}


@app.route('/api/admin/upload', methods=['POST'])
@require_admin
def upload_file():
    """Upload a question bank file (JSONL/JSON/CSV). Admin only."""
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    f = request.files['file']
    if not f.filename:
        return jsonify({'success': False, 'error': 'Empty filename'}), 400

    filename = secure_filename(f.filename)
    if not filename:
        return jsonify({'success': False, 'error': 'Invalid filename'}), 400

    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        return jsonify({
            'success': False,
            'error': f'File type not allowed. Permitted: {", ".join(sorted(ALLOWED_UPLOAD_EXTENSIONS))}'
        }), 400

    # MIME validation
    detected_mime = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
    if detected_mime not in ALLOWED_UPLOAD_MIMES:
        return jsonify({'success': False, 'error': 'MIME type not permitted'}), 400

    # Size check (belt-and-suspenders; MAX_CONTENT_LENGTH handles the hard limit)
    f.seek(0, 2)
    size = f.tell()
    if size > MAX_UPLOAD_MB * 1024 * 1024:
        return jsonify({'success': False, 'error': f'File exceeds {MAX_UPLOAD_MB} MB limit'}), 413
    f.seek(0)

    content = f.read()

    # Validate structure for JSONL
    if ext == '.jsonl':
        errors = []
        for i, line in enumerate(content.decode('utf-8', errors='replace').splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f'Line {i}: {e}')
            if len(errors) >= 5:
                break
        if errors:
            return jsonify({'success': False, 'error': 'Invalid JSONL', 'details': errors}), 422

    logger.info('[%s] file upload accepted filename=%s size=%d ip=%s',
                g.get('request_id', '-'), filename, size, get_client_ip())

    return jsonify({
        'success': True,
        'filename': filename,
        'size': size,
        'message': 'File validated. Integrate with build_database.py to import questions.'
    })


# =============================================================================
# WebSocket Events
# =============================================================================

@socketio.on('connect')
def on_ws_connect(auth):
    token = (auth or {}).get('token', '')
    if token:
        payload = _decode_jwt(token)
        if payload:
            logger.info('ws connect user=%s sid=%s', payload.get('username', '?'), request.sid)
        else:
            logger.info('ws connect invalid-token sid=%s ip=%s', request.sid, get_client_ip())
    else:
        logger.info('ws connect anonymous sid=%s ip=%s', request.sid, get_client_ip())


@socketio.on('disconnect')
def on_ws_disconnect():
    logger.info('ws disconnect sid=%s', request.sid)


# =============================================================================
# Logout — revoke the JWT so it cannot be reused before expiry
# =============================================================================

@app.route('/api/logout', methods=['POST'])
def logout_user():
    """Revoke the caller's JWT. Works for both user and admin tokens."""
    token = _extract_token()
    if token:
        payload = _decode_jwt(token)
        if payload:
            _revoke_token(payload['jti'], payload.get('exp', 0))
            _cleanup_revoked_tokens()  # opportunistic cleanup
            logger.info('[%s] token revoked sub=%s ip=%s',
                        g.get('request_id', '-'), payload.get('sub'), get_client_ip())
    return jsonify({'success': True})


# =============================================================================
# User Avatar — upload + serve
# =============================================================================

@app.route('/api/user/avatar/<int:user_id>', methods=['GET'])
def get_avatar(user_id: int):
    """Serve a user's avatar blob. Returns 404 if none uploaded."""
    try:
        db = get_db()
        ensure_tables()
        row = db.execute('SELECT avatar_data, avatar_type FROM users WHERE id = ?', (user_id,)).fetchone()
        if not row or not row['avatar_data']:
            return Response(status=404)
        mime = row['avatar_type'] or 'image/jpeg'
        return Response(row['avatar_data'], mimetype=mime,
                        headers={'Cache-Control': 'public, max-age=86400'})
    except Exception as e:
        return Response(status=500)


def _save_avatar(user_id: int, file_storage) -> str | None:
    """Validate and store an avatar image; returns error string or None on success."""
    if not file_storage or not file_storage.filename:
        return 'No file provided'
    mime = file_storage.content_type or ''
    if mime not in ALLOWED_AVATAR_MIMES:
        # Try to detect from extension
        ext = os.path.splitext(file_storage.filename)[1].lower()
        mime_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                    '.gif': 'image/gif', '.webp': 'image/webp'}
        mime = mime_map.get(ext, '')
        if not mime:
            return 'File type not allowed (JPEG, PNG, GIF, WebP only)'
    file_storage.seek(0, 2)
    size = file_storage.tell()
    file_storage.seek(0)
    if size > MAX_AVATAR_BYTES:
        return f'Avatar exceeds {MAX_AVATAR_BYTES // 1024 // 1024} MB limit'
    data = file_storage.read()
    db = get_db()
    ensure_tables()
    db.execute('UPDATE users SET avatar_data = ?, avatar_type = ? WHERE id = ?', (data, mime, user_id))
    db.commit()
    return None


@app.route('/api/user/avatar', methods=['POST'])
@require_user
def upload_own_avatar():
    """Upload the authenticated user's own avatar."""
    if 'avatar' not in request.files:
        return jsonify({'success': False, 'error': 'No file in request (field: avatar)'}), 400
    err = _save_avatar(g.jwt_user_id, request.files['avatar'])
    if err:
        return jsonify({'success': False, 'error': err}), 400
    return jsonify({'success': True, 'avatarUrl': f'/api/user/avatar/{g.jwt_user_id}'})


@app.route('/api/admin/users/<int:user_id>/avatar', methods=['POST'])
@require_admin
def upload_user_avatar_admin(user_id: int):
    """Admin: upload / replace a user's avatar."""
    db = get_db()
    ensure_tables()
    if not db.execute('SELECT id FROM users WHERE id = ?', (user_id,)).fetchone():
        return jsonify({'success': False, 'error': 'User not found'}), 404
    if 'avatar' not in request.files:
        return jsonify({'success': False, 'error': 'No file in request (field: avatar)'}), 400
    err = _save_avatar(user_id, request.files['avatar'])
    if err:
        return jsonify({'success': False, 'error': err}), 400
    return jsonify({'success': True, 'avatarUrl': f'/api/user/avatar/{user_id}'})


# =============================================================================
# Logo — admin upload + public serve
# =============================================================================

@app.route('/api/logo', methods=['GET'])
def get_logo():
    """Serve the custom app logo if one has been uploaded, else 404."""
    try:
        db = get_db()
        ensure_tables()
        row = db.execute("SELECT value FROM app_config WHERE key = 'logo_type'").fetchone()
        logo_type = row['value'] if row else None
        row2 = db.execute("SELECT value FROM app_config WHERE key = 'logo_data'").fetchone()
        logo_b64 = row2['value'] if row2 else None
        if not logo_b64 or not logo_type:
            return Response(status=404)
        data = base64.b64decode(logo_b64)
        return Response(data, mimetype=logo_type,
                        headers={'Cache-Control': 'public, max-age=3600'})
    except Exception:
        return Response(status=500)


@app.route('/api/admin/logo', methods=['POST'])
@require_admin
def upload_logo():
    """Admin: upload a new app logo (PNG/SVG/JPEG/WebP, max 1 MB)."""
    if 'logo' not in request.files:
        return jsonify({'success': False, 'error': 'No file in request (field: logo)'}), 400
    f = request.files['logo']
    mime = f.content_type or ''
    ALLOWED_LOGO_MIMES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'}
    if mime not in ALLOWED_LOGO_MIMES:
        ext = os.path.splitext(f.filename or '')[1].lower()
        ext_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                   '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif'}
        mime = ext_map.get(ext, '')
        if not mime:
            return jsonify({'success': False, 'error': 'Allowed: JPEG, PNG, SVG, WebP, GIF'}), 400
    f.seek(0, 2)
    size = f.tell()
    f.seek(0)
    if size > 1024 * 1024:
        return jsonify({'success': False, 'error': 'Logo exceeds 1 MB'}), 413
    data = f.read()
    b64 = base64.b64encode(data).decode()
    db = get_db()
    ensure_tables()
    for key, val in [('logo_data', b64), ('logo_type', mime)]:
        db.execute('''INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP''', (key, val, val))
    db.commit()
    logger.info('[%s] logo updated mime=%s size=%d', g.get('request_id', '-'), mime, size)
    return jsonify({'success': True})


@app.route('/api/admin/logo', methods=['DELETE'])
@require_admin
def delete_logo():
    """Admin: remove the custom logo, reverting to the default logo.svg."""
    db = get_db()
    ensure_tables()
    db.execute("DELETE FROM app_config WHERE key IN ('logo_data','logo_type')")
    db.commit()
    return jsonify({'success': True})


# =============================================================================
# Passkey / WebAuthn routes
# =============================================================================

@app.route('/auth/passkey/register/options', methods=['POST'])
def passkey_register_options():
    if not ACCOUNTS_ENABLED:
        return jsonify({'error': 'Accounts disabled'}), 404
    if not PASSKEY_SUPPORT:
        return jsonify({'error': 'Passkey support not available on this server'}), 501
    ip = get_client_ip()
    if not _register_rate_ok(ip):
        return jsonify({'error': 'Too many registration attempts'}), 429
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    err = _validate_username(username)
    if err:
        return jsonify({'error': err}), 400
    db = get_db()
    ensure_tables()
    existing = db.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
    if existing:
        user_db_id = existing['id']
        is_new_user = False
    else:
        user_db_id = None
        is_new_user = True
    # Use a stable bytes ID: new users get a tmp UUID, existing get their DB id
    uid_hex = uuid.uuid4().hex if is_new_user else f'{user_db_id:016x}'
    user_id_bytes = bytes.fromhex(uid_hex) if len(uid_hex) == 32 else uid_hex.encode()[:16]
    options = _webauthn.generate_registration_options(
        rp_id=RP_ID, rp_name=RP_NAME,
        user_id=user_id_bytes, user_name=username, user_display_name=username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )
    cid = _pk_put({'challenge': options.challenge, 'username': username,
                   'is_new_user': is_new_user, 'db_id': user_db_id})
    return jsonify({'cid': cid, 'options': json.loads(_webauthn.options_to_json(options))})


@app.route('/auth/passkey/register/verify', methods=['POST'])
def passkey_register_verify():
    if not ACCOUNTS_ENABLED:
        return jsonify({'error': 'Accounts disabled'}), 404
    if not PASSKEY_SUPPORT:
        return jsonify({'error': 'Passkey support not available on this server'}), 501
    ip = get_client_ip()
    data = request.get_json(silent=True) or {}
    c = _pk_take(data.get('cid'))
    if not c:
        return jsonify({'error': 'Challenge expired — please try again'}), 400
    cred_data = data.get('credential')
    if not cred_data or not isinstance(cred_data, dict):
        return jsonify({'error': 'Missing credential'}), 400
    try:
        resp = cred_data.get('response', {})
        transports = []
        for t in (resp.get('transports') or []):
            try:
                transports.append(AuthenticatorTransport(t))
            except ValueError:
                pass
        cred = RegistrationCredential(
            id=cred_data['id'],
            raw_id=_b64url_to_bytes(cred_data['rawId']),
            response=AuthenticatorAttestationResponse(
                client_data_json=_b64url_to_bytes(resp['clientDataJSON']),
                attestation_object=_b64url_to_bytes(resp['attestationObject']),
                transports=transports,
            ),
        )
    except Exception as exc:
        logger.warning('Passkey register parse error: %s', exc)
        return jsonify({'error': 'Invalid credential format'}), 400
    try:
        verification = _webauthn.verify_registration_response(
            credential=cred, expected_challenge=c['challenge'],
            expected_rp_id=RP_ID, expected_origin=_passkey_origin(),
            require_user_verification=False,
        )
    except Exception as exc:
        logger.warning('Passkey register verify error: %s', exc)
        return jsonify({'error': 'Passkey verification failed: ' + str(exc)}), 400
    cred_id = _bytes_to_b64url(verification.credential_id)
    pub_key = _bytes_to_b64url(verification.credential_public_key)
    sign_count = verification.sign_count
    transports_list = [t.value if hasattr(t, 'value') else str(t) for t in transports]
    db = get_db()
    ensure_tables()
    if c['is_new_user']:
        _record_register_attempt(ip)
        try:
            db.execute('INSERT INTO users (username, password_hash) VALUES (?, NULL)', (c['username'],))
            db.commit()
            user_row = db.execute('SELECT id, username FROM users WHERE username = ?', (c['username'],)).fetchone()
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Username already taken'}), 409
        user_id = user_row['id']
    else:
        user_id = c['db_id']
        user_row = db.execute('SELECT id, username FROM users WHERE id = ?', (user_id,)).fetchone()
        if not user_row:
            return jsonify({'error': 'User not found'}), 404
    try:
        db.execute('INSERT OR REPLACE INTO passkeys (cred_id, user_id, public_key, sign_count, transports) VALUES (?,?,?,?,?)',
                   (cred_id, user_id, pub_key, sign_count, json.dumps(transports_list)))
        db.commit()
    except Exception as exc:
        logger.error('Passkey store error: %s', exc)
        return jsonify({'error': 'Failed to store passkey'}), 500
    token = _issue_jwt(str(user_id), 'user', {'username': user_row['username']})
    logger.info('[%s] passkey registered username=%s ip=%s', g.get('request_id', '-'), c['username'], ip)
    return jsonify({'success': True, 'token': token, 'user': {'id': user_id, 'username': user_row['username']}}), (201 if c['is_new_user'] else 200)


@app.route('/auth/passkey/login/options', methods=['POST'])
def passkey_login_options():
    if not ACCOUNTS_ENABLED:
        return jsonify({'error': 'Accounts disabled'}), 404
    if not PASSKEY_SUPPORT:
        return jsonify({'error': 'Passkey support not available on this server'}), 501
    options = _webauthn.generate_authentication_options(
        rp_id=RP_ID,
        user_verification=UserVerificationRequirement.PREFERRED,
        allow_credentials=[],
    )
    cid = _pk_put({'challenge': options.challenge})
    return jsonify({'cid': cid, 'options': json.loads(_webauthn.options_to_json(options))})


@app.route('/auth/passkey/login/verify', methods=['POST'])
def passkey_login_verify():
    if not ACCOUNTS_ENABLED:
        return jsonify({'error': 'Accounts disabled'}), 404
    if not PASSKEY_SUPPORT:
        return jsonify({'error': 'Passkey support not available on this server'}), 501
    ip = get_client_ip()
    if not _login_rate_ok(ip):
        return jsonify({'error': 'Too many login attempts'}), 429
    data = request.get_json(silent=True) or {}
    c = _pk_take(data.get('cid'))
    if not c:
        return jsonify({'error': 'Challenge expired — please try again'}), 400
    cred_data = data.get('credential')
    if not cred_data or not isinstance(cred_data, dict):
        return jsonify({'error': 'Missing credential'}), 400
    db = get_db()
    ensure_tables()
    passkey = db.execute('SELECT * FROM passkeys WHERE cred_id = ?', (cred_data.get('id'),)).fetchone()
    if not passkey:
        return jsonify({'error': 'Unknown passkey — please register first'}), 404
    try:
        resp = cred_data.get('response', {})
        cred = AuthenticationCredential(
            id=cred_data['id'],
            raw_id=_b64url_to_bytes(cred_data['rawId']),
            response=AuthenticatorAssertionResponse(
                client_data_json=_b64url_to_bytes(resp['clientDataJSON']),
                authenticator_data=_b64url_to_bytes(resp['authenticatorData']),
                signature=_b64url_to_bytes(resp['signature']),
                user_handle=_b64url_to_bytes(resp['userHandle']) if resp.get('userHandle') else None,
            ),
        )
    except Exception as exc:
        logger.warning('Passkey login parse error: %s', exc)
        return jsonify({'error': 'Invalid credential format'}), 400
    try:
        verification = _webauthn.verify_authentication_response(
            credential=cred, expected_challenge=c['challenge'],
            expected_rp_id=RP_ID, expected_origin=_passkey_origin(),
            credential_public_key=_b64url_to_bytes(passkey['public_key']),
            credential_current_sign_count=passkey['sign_count'],
            require_user_verification=False,
        )
    except Exception as exc:
        _record_login_failure(ip)
        logger.warning('Passkey login verify error: %s', exc)
        return jsonify({'error': 'Passkey authentication failed'}), 401
    db.execute('UPDATE passkeys SET sign_count = ?, last_used_at = CURRENT_TIMESTAMP WHERE cred_id = ?',
               (verification.new_sign_count, passkey['cred_id']))
    db.commit()
    user = db.execute('SELECT id, username FROM users WHERE id = ?', (passkey['user_id'],)).fetchone()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    _reset_login_failures(ip)
    token = _issue_jwt(str(user['id']), 'user', {'username': user['username']})
    logger.info('[%s] passkey login username=%s ip=%s', g.get('request_id', '-'), user['username'], ip)
    return jsonify({'success': True, 'token': token, 'user': {'id': user['id'], 'username': user['username']}})


# =============================================================================
# Error Handlers
# =============================================================================

@app.errorhandler(404)
def not_found(e):
    return jsonify({'success': False, 'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({'success': False, 'error': 'Internal server error'}), 500

@app.errorhandler(429)
def rate_limit_exceeded(e):
    return jsonify({'success': False, 'error': 'Rate limit exceeded'}), 429

# =============================================================================
# Main
# =============================================================================

if __name__ == '__main__':
    port = int(os.environ.get('API_PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'

    print(f"Starting Trivia Quest API on port {port}")
    print(f"Database: {DATABASE_PATH}")
    print(f"CORS origins: {CORS_ALLOWED_ORIGINS}")
    print(f"Trust proxy: {TRUST_PROXY}")
    print(f"Accounts enabled: {ACCOUNTS_ENABLED}")
    print(f"Require user password: {REQUIRE_USER_PASSWORD}")
    print(f"JWT TTL: {JWT_TTL}s")
    print(f"Max upload: {MAX_UPLOAD_MB} MB")

    socketio.run(app, host='0.0.0.0', port=port, debug=debug, use_reloader=debug)
