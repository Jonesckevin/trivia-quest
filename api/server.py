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
import hashlib
from datetime import datetime
from functools import wraps
from flask import Flask, jsonify, request, g, Response
from flask_cors import CORS

app = Flask(__name__)

# Configuration
DATABASE_PATH = os.environ.get('DATABASE_PATH', '/data/questions.db')
ALLOWED_ORIGINS = os.environ.get('ALLOWED_ORIGINS', '*').split(',')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123')
FREEPLAY_DEFAULT = os.environ.get('FREEPLAY', 'false').lower() == 'true'
REQUIRE_USER_PASSWORD = os.environ.get('REQUIRE_USER_PASSWORD', 'false').lower() == 'true'
MAX_QUESTIONS_PER_REQUEST = 500

# Security: Configure CORS
CORS(app, origins=ALLOWED_ORIGINS, methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])

# =============================================================================
# Security Middleware
# =============================================================================

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-cache'
    return response

def sanitize_input(text):
    """Sanitize user input to prevent injection attacks."""
    if not isinstance(text, str):
        return text
    sanitized = re.sub(r'[^\w\s\-\.,!?\(\)]', '', text)
    return sanitized[:200]

def require_admin(f):
    """Decorator to require admin authentication."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get('X-Admin-Token', '')
        if not auth or auth != _get_admin_token():
            return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated

def _get_admin_token():
    """Generate admin token from password (simple hash for session use)."""
    return hashlib.sha256(ADMIN_PASSWORD.encode()).hexdigest()

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
    ''')
    db.commit()
    # Migrate existing databases: add profile columns if missing
    cols = {row['name'] for row in db.execute("PRAGMA table_info(users)").fetchall()}
    for col, typedef in [('display_name', 'TEXT'), ('email', 'TEXT'), ('bio', 'TEXT'), ('role', 'TEXT'), ('organization', 'TEXT'), ('phone', 'TEXT')]:
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
                'freeplay': freeplay,
                'requireUserPassword': REQUIRE_USER_PASSWORD,
                'appTitle': os.environ.get('APP_TITLE', 'Trivia Quest')
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
    """Verify admin password and return session token."""
    data = request.get_json()
    if not data or 'password' not in data:
        return jsonify({'success': False, 'error': 'Password required'}), 400
    
    if data['password'] == ADMIN_PASSWORD:
        return jsonify({
            'success': True,
            'token': _get_admin_token()
        })
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
                'freeplay': freeplay,
                'freeplayDefault': FREEPLAY_DEFAULT,
                'requireUserPassword': REQUIRE_USER_PASSWORD,
                'adminPassword': '***'
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/admin/config', methods=['POST'])
@require_admin
def update_admin_config():
    """Update runtime configuration."""
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
    """Register a new user."""
    try:
        data = request.get_json()
        if not data or 'username' not in data:
            return jsonify({'success': False, 'error': 'Username required'}), 400
        
        username = data['username'].strip()
        if not username or len(username) < 2 or len(username) > 30:
            return jsonify({'success': False, 'error': 'Username must be 2-30 characters'}), 400
        
        if not re.match(r'^[\w\s\-]+$', username):
            return jsonify({'success': False, 'error': 'Username contains invalid characters'}), 400
        
        db = get_db()
        ensure_tables()
        
        password_hash = None
        if REQUIRE_USER_PASSWORD:
            password = data.get('password', '')
            if not password or len(password) < 4:
                return jsonify({'success': False, 'error': 'Password must be at least 4 characters'}), 400
            password_hash = hashlib.sha256(password.encode()).hexdigest()
        
        try:
            db.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)',
                      (username, password_hash))
            db.commit()
            user = db.execute('SELECT id, username, display_name, email, bio FROM users WHERE username = ?', (username,)).fetchone()
            
            return jsonify({
                'success': True,
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
    """Login existing user."""
    try:
        data = request.get_json()
        if not data or 'username' not in data:
            return jsonify({'success': False, 'error': 'Username required'}), 400
        
        username = data['username'].strip()
        db = get_db()
        ensure_tables()
        
        user = db.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        if not user:
            return jsonify({'success': False, 'error': 'User not found'})
        
        if REQUIRE_USER_PASSWORD:
            password = data.get('password', '')
            password_hash = hashlib.sha256(password.encode()).hexdigest()
            if user['password_hash'] != password_hash:
                return jsonify({'success': False, 'error': 'Invalid password'})
        
        return jsonify({
            'success': True,
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
def submit_answer():
    """Submit a single answer. Called after each question."""
    try:
        data = request.get_json()
        required = ['userId', 'sessionId', 'questionId', 'selectedAnswers']
        if not data or not all(k in data for k in required):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
        
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
def complete_quiz():
    """Mark a quiz as completed for a user."""
    try:
        data = request.get_json()
        required = ['userId', 'sessionId']
        if not data or not all(k in data for k in required):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
        
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
            if len(data['password']) < 4:
                return jsonify({'success': False, 'error': 'Password must be at least 4 characters'}), 400
            updates.append('password_hash = ?')
            params.append(hashlib.sha256(data['password'].encode()).hexdigest())
        
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
    
    print(f"Starting Question API Server on port {port}")
    print(f"Database: {DATABASE_PATH}")
    print(f"Freeplay Default: {FREEPLAY_DEFAULT}")
    print(f"Require User Password: {REQUIRE_USER_PASSWORD}")
    
    app.run(host='0.0.0.0', port=port, debug=debug)
