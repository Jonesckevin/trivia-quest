#!/usr/bin/env python3
"""
Lightweight API server for serving question categories from SQLite database.
Uses Flask with security best practices.
"""

import json
import sqlite3
import os
import re
from functools import wraps
from flask import Flask, jsonify, request, g
from flask_cors import CORS

app = Flask(__name__)

# Configuration
DATABASE_PATH = os.environ.get('DATABASE_PATH', '/data/questions.db')
ALLOWED_ORIGINS = os.environ.get('ALLOWED_ORIGINS', '*').split(',')
MAX_QUESTIONS_PER_REQUEST = 500
RATE_LIMIT_REQUESTS = 100  # per minute

# Security: Configure CORS
CORS(app, origins=ALLOWED_ORIGINS, methods=['GET', 'OPTIONS'])

# =============================================================================
# Security Middleware
# =============================================================================

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    # Prevent clickjacking
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    # Prevent MIME type sniffing
    response.headers['X-Content-Type-Options'] = 'nosniff'
    # XSS Protection
    response.headers['X-XSS-Protection'] = '1; mode=block'
    # Referrer Policy
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    # Permissions Policy
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
    # Cache control for API responses
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'public, max-age=3600'
    return response

def sanitize_input(text):
    """Sanitize user input to prevent injection attacks."""
    if not isinstance(text, str):
        return text
    # Remove any potential SQL injection patterns
    # Only allow alphanumeric, spaces, and basic punctuation
    sanitized = re.sub(r'[^\w\s\-\.,!?\(\)]', '', text)
    return sanitized[:200]  # Limit length

# =============================================================================
# Database Connection
# =============================================================================

def get_db():
    """Get database connection for current request."""
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(exception):
    """Close database connection at end of request."""
    db = g.pop('db', None)
    if db is not None:
        db.close()

# =============================================================================
# API Endpoints
# =============================================================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    try:
        db = get_db()
        db.execute('SELECT 1')
        return jsonify({'status': 'healthy', 'database': 'connected'})
    except Exception as e:
        return jsonify({'status': 'unhealthy', 'error': str(e)}), 500

@app.route('/api/categories', methods=['GET'])
def get_categories():
    """Get all available question categories."""
    try:
        db = get_db()
        cursor = db.execute('''
            SELECT id, name, source_file, question_count, created_at
            FROM categories
            ORDER BY name
        ''')
        
        categories = []
        for row in cursor.fetchall():
            # Get subcategories for each category
            sub_cursor = db.execute('''
                SELECT DISTINCT subcategory, COUNT(*) as count
                FROM questions
                WHERE category_id = ? AND subcategory IS NOT NULL AND subcategory != ''
                GROUP BY subcategory
                ORDER BY subcategory
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
        # Validate category_id
        if category_id < 1 or category_id > 10000:
            return jsonify({'success': False, 'error': 'Invalid category ID'}), 400
        
        # Optional filters
        subcategory = request.args.get('subcategory', '')
        difficulty = request.args.get('difficulty', '')
        limit = min(int(request.args.get('limit', MAX_QUESTIONS_PER_REQUEST)), MAX_QUESTIONS_PER_REQUEST)
        
        db = get_db()
        
        # Verify category exists
        cat_cursor = db.execute('SELECT name FROM categories WHERE id = ?', (category_id,))
        cat_row = cat_cursor.fetchone()
        if not cat_row:
            return jsonify({'success': False, 'error': 'Category not found'}), 404
        
        # Build query with optional filters
        query = 'SELECT * FROM questions WHERE category_id = ?'
        params = [category_id]
        
        if subcategory:
            subcategory = sanitize_input(subcategory)
            query += ' AND subcategory = ?'
            params.append(subcategory)
        
        if difficulty and difficulty in ('L1', 'L2'):
            query += ' AND difficulty = ?'
            params.append(difficulty)
        
        query += ' LIMIT ?'
        params.append(limit)
        
        cursor = db.execute(query, params)
        
        questions = []
        for row in cursor.fetchall():
            question_obj = {
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
        
        # Get counts
        cat_count = db.execute('SELECT COUNT(*) FROM categories').fetchone()[0]
        q_count = db.execute('SELECT COUNT(*) FROM questions').fetchone()[0]
        
        # Get difficulty breakdown
        diff_cursor = db.execute('''
            SELECT difficulty, COUNT(*) as count
            FROM questions
            GROUP BY difficulty
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
    
    app.run(host='0.0.0.0', port=port, debug=debug)
