#!/usr/bin/env python3
"""
Build SQLite database from JSONL question bank files.
This script is run during Docker build to create a pre-populated database.
"""

import json
import sqlite3
import os
import sys
from pathlib import Path

DATABASE_PATH = '/data/questions.db'
QUESTION_BANK_PATH = '/question_bank'

def create_database(db_path: str) -> sqlite3.Connection:
    """Create the database schema."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create tables
    cursor.executescript('''
        -- Categories table
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            source_file TEXT NOT NULL,
            question_count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        -- Questions table
        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER NOT NULL,
            subcategory TEXT,
            difficulty TEXT NOT NULL,
            question TEXT NOT NULL,
            answers TEXT NOT NULL,
            incorrect_answers TEXT NOT NULL,
            question_type TEXT NOT NULL DEFAULT 'multiple_choice',
            description TEXT,
            regex_pattern TEXT,
            regex_description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (category_id) REFERENCES categories(id)
        );
        
        -- Create indexes for efficient querying
        CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category_id);
        CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
        CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(question_type);
        CREATE INDEX IF NOT EXISTS idx_questions_subcategory ON questions(subcategory);
    ''')
    
    conn.commit()
    return conn

def parse_jsonl_file(file_path: str) -> list:
    """Parse a JSONL file and return list of questions."""
    questions = []
    with open(file_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                questions.append(data)
            except json.JSONDecodeError as e:
                print(f"Warning: Failed to parse line {line_num} in {file_path}: {e}")
    return questions

def get_category_name_from_file(filename: str) -> str:
    """Extract a friendly category name from filename."""
    # Remove extension and convert to title case
    name = Path(filename).stem
    # Remove common suffixes
    for suffix in ['-questions', '_questions', '-trivia', '_trivia']:
        name = name.replace(suffix, '')
    # Convert to title case with proper spacing
    name = name.replace('-', ' ').replace('_', ' ')
    return name.title()

def import_questions(conn: sqlite3.Connection, question_bank_path: str):
    """Import all questions from JSONL files into the database."""
    cursor = conn.cursor()
    
    total_questions = 0
    total_categories = 0
    
    # Find all JSONL files
    jsonl_files = list(Path(question_bank_path).glob('*.jsonl'))
    
    if not jsonl_files:
        print(f"Warning: No JSONL files found in {question_bank_path}")
        return
    
    print(f"Found {len(jsonl_files)} JSONL files to import")
    
    for jsonl_file in sorted(jsonl_files):
        filename = jsonl_file.name
        category_name = get_category_name_from_file(filename)
        
        print(f"Processing: {filename} -> {category_name}")
        
        # Parse questions from file
        questions = parse_jsonl_file(str(jsonl_file))
        
        if not questions:
            print(f"  Skipping: No valid questions found")
            continue
        
        # Insert category
        cursor.execute('''
            INSERT OR IGNORE INTO categories (name, source_file, question_count)
            VALUES (?, ?, ?)
        ''', (category_name, filename, len(questions)))
        
        # Get category ID
        cursor.execute('SELECT id FROM categories WHERE name = ?', (category_name,))
        category_id = cursor.fetchone()[0]
        
        # Insert questions
        for q in questions:
            # Handle both "Category" (subcategory within file) and top-level category
            subcategory = q.get('Category', '')
            difficulty = q.get('Difficulty', 'L1')
            question_text = q.get('Question', '')
            
            # Question type - default to multiple_choice
            # Support both 'regex' (legacy) and 'general' (new) type names
            question_type = q.get('Type', 'multiple_choice')
            if question_type == 'regex':
                question_type = 'general'  # Normalize legacy 'regex' to 'general'
            if question_type not in ('multiple_choice', 'multiple_answer', 'hidden', 'general'):
                question_type = 'multiple_choice'
            
            # Optional metadata fields
            description = q.get('Description', '')
            regex_pattern = q.get('RegEx', '')
            regex_description = q.get('RegExDescription', '')
            
            # Answers can be a list
            answers = q.get('Answers', [])
            if isinstance(answers, str):
                answers = [answers]
            answers_json = json.dumps(answers)
            
            # Incorrect answers
            incorrect = q.get('IncorrectAnswers', [])
            if isinstance(incorrect, str):
                incorrect = [incorrect]
            incorrect_json = json.dumps(incorrect)
            
            if question_text:
                cursor.execute('''
                    INSERT INTO questions 
                    (category_id, subcategory, difficulty, question, answers, incorrect_answers,
                     question_type, description, regex_pattern, regex_description)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (category_id, subcategory, difficulty, question_text, answers_json, incorrect_json,
                      question_type, description, regex_pattern, regex_description))
        
        # Update question count
        cursor.execute('''
            UPDATE categories SET question_count = (
                SELECT COUNT(*) FROM questions WHERE category_id = ?
            ) WHERE id = ?
        ''', (category_id, category_id))
        
        total_questions += len(questions)
        total_categories += 1
        print(f"  Imported: {len(questions)} questions")
    
    conn.commit()
    print(f"\n✓ Import complete: {total_questions} questions in {total_categories} categories")

def main():
    """Main entry point."""
    db_path = os.environ.get('DATABASE_PATH', DATABASE_PATH)
    qb_path = os.environ.get('QUESTION_BANK_PATH', QUESTION_BANK_PATH)
    
    print(f"Building question database...")
    print(f"  Database: {db_path}")
    print(f"  Question Bank: {qb_path}")
    
    # Create database directory if needed
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    
    # Create and populate database
    conn = create_database(db_path)
    import_questions(conn, qb_path)
    
    # Verify
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) FROM categories')
    cat_count = cursor.fetchone()[0]
    cursor.execute('SELECT COUNT(*) FROM questions')
    q_count = cursor.fetchone()[0]
    
    print(f"\nDatabase verification:")
    print(f"  Categories: {cat_count}")
    print(f"  Questions: {q_count}")
    
    conn.close()
    print("\n✓ Database build complete!")

if __name__ == '__main__':
    main()
