// ==================== STATE ====================
let state = {
    questions: [],
    usedQuestions: new Set(),
    currentQuestion: null,
    currentQuestionIndex: null,
    currentCustomPoints: null,
    currentDisplayedPoints: null,
    teams: [{ name: 'Team 1', score: 0 }],
    teamCount: 1,
    gameMode: 'single', // 'single' or 'jeopardy'
    questionOrder: 'ordered', // 'ordered' or 'randomized'
    nextQuestionId: 1, // Auto-incrementing question ID
    usePointValues: false,
    l1Points: 100,
    l2Points: 200,
    jeopardyRows: 5,
    maxAvailableRows: 5,
    pointLabel: '',
    pointImageUrl: 'logo.svg',
    pointImageMode: 'none', // 'none', 'replace', 'fullcell'
    answerDifficulty: 'easy', // 'easy' (3 wrong), 'medium' (5 wrong), 'hard' (7 wrong)
    feedbackIntensity: 'full',
    volume: 0.5, // 0 to 1 volume level
    answerRevealed: false,
    presentationMode: false // Hide admin controls for participant view
};

// ==================== REGEX VALIDATION ====================
const REGEX_TIMEOUT_MS = 100;

// Common regex pattern templates for Add Question form
const REGEX_TEMPLATES = {
    number: { pattern: '^{value}$', description: 'Exact number match' },
    numberOrWord: { pattern: '^({value}|{word})$', description: 'Accepts numeric or word form' },
    year: { pattern: '^{value}$', description: 'Exact year match' },
    port: { pattern: '^(port\\s*)?{value}$', description: 'Port number with optional "port" prefix' },
    level: { pattern: '^(level\\s*)?{value}$', description: 'Level number with optional "level" prefix' },
    acronym: { pattern: null, description: 'Auto-generated from answer with flexible spacing' },
    caseInsensitive: { pattern: '^{value}$', description: 'Case-insensitive exact match' },
    contains: { pattern: '.*{value}.*', description: 'Contains the value anywhere' }
};

/**
 * Validate a regex pattern for safety and correctness
 * @param {string} pattern - The regex pattern to validate
 * @returns {{valid: boolean, error: string|null}}
 */
function validateRegexPattern(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        return { valid: false, error: 'Pattern is empty or invalid' };
    }
    
    // Check for potentially dangerous patterns (ReDoS)
    const dangerousPatterns = [
        /(\+|\*|\?)\1{2,}/,  // Multiple quantifiers
        /\([^)]*(\+|\*)[^)]*\)\+/,  // Nested quantifiers
        /(.+)\1+\+/,  // Backreference with quantifier
    ];
    
    for (const danger of dangerousPatterns) {
        if (danger.test(pattern)) {
            return { valid: false, error: 'Pattern contains potentially unsafe constructs' };
        }
    }
    
    // Try to compile the regex
    try {
        new RegExp(pattern, 'i');
        return { valid: true, error: null };
    } catch (e) {
        return { valid: false, error: `Invalid regex: ${e.message}` };
    }
}

/**
 * Validate user input against a regex pattern with timeout protection
 * @param {string} input - User's answer input
 * @param {string} pattern - Regex pattern to match against
 * @param {number} timeoutMs - Maximum execution time in milliseconds
 * @returns {Promise<{matched: boolean, error: string|null}>}
 */
async function validateRegexAnswer(input, pattern, timeoutMs = REGEX_TIMEOUT_MS) {
    // First validate the pattern itself
    const patternCheck = validateRegexPattern(pattern);
    if (!patternCheck.valid) {
        console.warn('Invalid regex pattern:', patternCheck.error);
        return { matched: false, error: patternCheck.error };
    }
    
    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            console.warn('Regex validation timed out');
            resolve({ matched: false, error: 'Validation timed out' });
        }, timeoutMs);
        
        try {
            const regex = new RegExp(pattern, 'i'); // Case-insensitive
            const matched = regex.test(input.trim());
            clearTimeout(timeoutId);
            resolve({ matched, error: null });
        } catch (e) {
            clearTimeout(timeoutId);
            resolve({ matched: false, error: e.message });
        }
    });
}

// ==================== SAMPLE QUESTIONS ====================
const sampleQuestions = [
    { Category: "Geography", Difficulty: "L1", Type: "multiple_choice", Question: "What is the capital of France?", Answers: ["Paris"], IncorrectAnswers: ["London", "Berlin", "Madrid", "Rome", "Vienna", "Amsterdam", "Brussels"] },
    { Category: "Geography", Difficulty: "L1", Type: "multiple_choice", Question: "Which continent is Brazil located in?", Answers: ["South America"], IncorrectAnswers: ["Africa", "Europe", "Asia", "North America", "Australia", "Central America", "Antarctica"] },
    { Category: "Geography", Difficulty: "L2", Type: "multiple_choice", Question: "What is the smallest country in the world by area?", Answers: ["Vatican City"], IncorrectAnswers: ["Monaco", "San Marino", "Liechtenstein", "Malta", "Andorra", "Luxembourg", "Singapore"] },
    { Category: "Geography", Difficulty: "L2", Type: "multiple_answer", Question: "Which river is the longest in the world?", Answers: ["Nile", "Amazon"], IncorrectAnswers: ["Mississippi", "Yangtze", "Congo", "Ganges", "Danube", "Mekong", "Volga"] },
    { Category: "Science", Difficulty: "L1", Type: "multiple_choice", Question: "What planet is known as the Red Planet?", Answers: ["Mars"], IncorrectAnswers: ["Venus", "Jupiter", "Saturn", "Mercury", "Neptune", "Uranus", "Pluto"] },
    { Category: "Science", Difficulty: "L1", Type: "general", Question: "What is the chemical symbol for water?", Answers: ["H2O"], IncorrectAnswers: [], RegEx: "^h2o$", RegExDescription: "Enter the chemical formula" },
    { Category: "Science", Difficulty: "L2", Type: "multiple_choice", Question: "What is the hardest natural substance on Earth?", Answers: ["Diamond"], IncorrectAnswers: ["Titanium", "Quartz", "Graphene", "Tungsten", "Steel", "Obsidian", "Sapphire"] },
    { Category: "Science", Difficulty: "L2", Type: "general", Question: "What is the speed of light in km/s (approximately)?", Answers: ["300,000", "300000"], IncorrectAnswers: [], RegEx: "^300[,.]?000$", RegExDescription: "Enter the approximate value in km/s" },
    { Category: "History", Difficulty: "L1", Type: "general", Question: "In which year did World War II end?", Answers: ["1945"], IncorrectAnswers: [], RegEx: "^1945$", RegExDescription: "Enter the year" },
    { Category: "History", Difficulty: "L1", Type: "multiple_choice", Question: "Who was the first President of the United States?", Answers: ["George Washington"], IncorrectAnswers: ["Abraham Lincoln", "Thomas Jefferson", "John Adams", "Benjamin Franklin", "James Madison", "Alexander Hamilton", "John Hancock"] },
    { Category: "History", Difficulty: "L2", Type: "multiple_answer", Question: "What ancient wonder was located in Alexandria, Egypt?", Answers: ["Lighthouse of Alexandria", "The Lighthouse"], IncorrectAnswers: ["Hanging Gardens", "Colossus of Rhodes", "Temple of Artemis", "Great Pyramid", "Statue of Zeus", "Mausoleum at Halicarnassus", "Library of Alexandria"] },
    { Category: "History", Difficulty: "L2", Type: "multiple_choice", Question: "Which empire was ruled by Genghis Khan?", Answers: ["Mongol Empire"], IncorrectAnswers: ["Ottoman Empire", "Roman Empire", "Persian Empire", "Byzantine Empire", "Mughal Empire", "Han Dynasty", "Qing Dynasty"] },
    { Category: "Pop Culture", Difficulty: "L1", Type: "multiple_choice", Question: "What is the name of Harry Potter's owl?", Answers: ["Hedwig"], IncorrectAnswers: ["Errol", "Pigwidgeon", "Scabbers", "Fawkes", "Crookshanks", "Nagini", "Buckbeak"] },
    { Category: "Pop Culture", Difficulty: "L1", Type: "multiple_choice", Question: "Which band performed 'Bohemian Rhapsody'?", Answers: ["Queen"], IncorrectAnswers: ["The Beatles", "Led Zeppelin", "Pink Floyd", "The Rolling Stones", "AC/DC", "Aerosmith", "Guns N' Roses"] },
    { Category: "Pop Culture", Difficulty: "L2", Type: "general", Question: "What year was the first iPhone released?", Answers: ["2007"], IncorrectAnswers: [], RegEx: "^2007$", RegExDescription: "Enter the year" },
    { Category: "Pop Culture", Difficulty: "L2", Type: "hidden", Question: "In the movie 'The Matrix', what color pill does Neo take?", Answers: ["Red"], IncorrectAnswers: [], Description: "The red pill represents truth and freedom from the simulation" }
];

// ==================== AUDIO ====================
let audioContext = null;

function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playSound(type) {
    if (state.volume === 0) return;
    
    initAudio();
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === 'correct') {
        // Pleasant chime - ascending notes
        oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
        oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); // E5
        oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2); // G5
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0.3 * state.volume, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.4);
    } else if (type === 'wrong') {
        // Low buzz
        oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
        oscillator.type = 'sawtooth';
        gainNode.gain.setValueAtTime(0.2 * state.volume, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
    }
}

// ==================== DOM ELEMENTS ====================
const elements = {
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    mainContent: document.getElementById('mainContent'),
    
    // Mode buttons
    singleModeBtn: document.getElementById('singleModeBtn'),
    jeopardyModeBtn: document.getElementById('jeopardyModeBtn'),
    singleMode: document.getElementById('singleMode'),
    jeopardyMode: document.getElementById('jeopardyMode'),
    
    // Team settings
    teamCount: document.getElementById('teamCount'),
    teamNames: document.getElementById('teamNames'),
    
    // Points settings
    usePointValues: document.getElementById('usePointValues'),
    pointSettings: document.getElementById('pointSettings'),
    l1Points: document.getElementById('l1Points'),
    l2Points: document.getElementById('l2Points'),
    
    // Effects
    feedbackIntensity: document.getElementById('feedbackIntensity'),
    volumeSlider: document.getElementById('volumeSlider'),
    volumeIcon: document.getElementById('volumeIcon'),
    volumeLabel: document.getElementById('volumeLabel'),
    answerDifficulty: document.getElementById('answerDifficulty'),
    questionOrder: document.getElementById('questionOrder'),
    
    // Jeopardy settings
    jeopardyRows: document.getElementById('jeopardyRows'),
    maxRowsInfo: document.getElementById('maxRowsInfo'),
    pointLabel: document.getElementById('pointLabel'),
    pointImageUrl: document.getElementById('pointImageUrl'),
    pointImageMode: document.getElementById('pointImageMode'),
    imagePreviewGroup: document.getElementById('imagePreviewGroup'),
    pointImagePreview: document.getElementById('pointImagePreview'),
    
    // Question management
    loadSampleBtn: document.getElementById('loadSampleBtn'),
    importBtn: document.getElementById('importBtn'),
    importFile: document.getElementById('importFile'),
    exportBtn: document.getElementById('exportBtn'),
    addQuestionForm: document.getElementById('addQuestionForm'),
    resetBtn: document.getElementById('resetBtn'),
    resetScoresBtn: document.getElementById('resetScoresBtn'),
    resetQuestionsBtn: document.getElementById('resetQuestionsBtn'),
    
    // Question counter
    questionCounter: document.getElementById('questionCounter'),
    remainingCount: document.getElementById('remainingCount'),
    
    // Single mode elements
    questionCard: document.getElementById('questionCard'),
    currentCategory: document.getElementById('currentCategory'),
    currentDifficulty: document.getElementById('currentDifficulty'),
    currentPoints: document.getElementById('currentPoints'),
    questionText: document.getElementById('questionText'),
    answersGrid: document.getElementById('answersGrid'),
    nextQuestionBtn: document.getElementById('nextQuestionBtn'),
    skipQuestionBtn: document.getElementById('skipQuestionBtn'),
    
    // Jeopardy elements
    jeopardyBoard: document.getElementById('jeopardyBoard'),
    
    // Modal elements
    questionModal: document.getElementById('questionModal'),
    modalCategory: document.getElementById('modalCategory'),
    modalDifficulty: document.getElementById('modalDifficulty'),
    modalPoints: document.getElementById('modalPoints'),
    modalQuestionText: document.getElementById('modalQuestionText'),
    modalAnswersGrid: document.getElementById('modalAnswersGrid'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    
    // Add Question Modal
    addQuestionModal: document.getElementById('addQuestionModal'),
    openAddQuestionBtn: document.getElementById('openAddQuestionBtn'),
    closeAddQuestionBtn: document.getElementById('closeAddQuestionBtn'),
    bulkAddBtn: document.getElementById('bulkAddBtn'),
    singleAddForm: document.getElementById('singleAddForm'),
    bulkAddForm: document.getElementById('bulkAddForm'),
    bulkAddRows: document.getElementById('bulkAddRows'),
    addBulkRowBtn: document.getElementById('addBulkRowBtn'),
    submitBulkBtn: document.getElementById('submitBulkBtn'),
    newType: document.getElementById('newType'),
    newDescription: document.getElementById('newDescription'),
    newRegex: document.getElementById('newRegex'),
    newRegexDescription: document.getElementById('newRegexDescription'),
    regexTemplate: document.getElementById('regexTemplate'),
    regexGroup: document.getElementById('regexGroup'),
    regexDescGroup: document.getElementById('regexDescGroup'),
    incorrectAnswersGroup: document.getElementById('incorrectAnswersGroup'),
    
    // Categories Modal (Server Questions)
    categoriesModal: document.getElementById('categoriesModal'),
    browseServerBtn: document.getElementById('browseServerBtn'),
    closeCategoriesBtn: document.getElementById('closeCategoriesBtn'),
    categoriesLoading: document.getElementById('categoriesLoading'),
    categoriesError: document.getElementById('categoriesError'),
    categoriesList: document.getElementById('categoriesList'),
    serverStats: document.getElementById('serverStats'),
    retryLoadCategories: document.getElementById('retryLoadCategories'),
    
    // Scoreboard
    scoreboard: document.getElementById('scoreboard'),
    scoreboardInner: document.getElementById('scoreboardInner'),
    awardPoints: document.getElementById('awardPoints'),
    awardButtons: document.getElementById('awardButtons'),
    noPointsBtn: document.getElementById('noPointsBtn'),
    
    // Inline award sections
    questionActions: document.getElementById('questionActions'),
    singleAwardSection: document.getElementById('singleAwardSection'),
    singleNoPointsBtn: document.getElementById('singleNoPointsBtn'),
    modalCloseSection: document.getElementById('modalCloseSection'),
    modalAwardSection: document.getElementById('modalAwardSection'),
    modalNoPointsBtn: document.getElementById('modalNoPointsBtn')
};

// ==================== STORAGE ====================
function saveState() {
    const saveData = {
        ...state,
        usedQuestions: Array.from(state.usedQuestions)
    };
    localStorage.setItem('triviaQuestState', JSON.stringify(saveData));
}

function loadState() {
    const saved = localStorage.getItem('triviaQuestState');
    if (saved) {
        const parsed = JSON.parse(saved);
        state = {
            ...parsed,
            usedQuestions: new Set(parsed.usedQuestions || []),
            // Ensure new fields have defaults for older saved states
            questionOrder: parsed.questionOrder || 'ordered',
            nextQuestionId: parsed.nextQuestionId || (parsed.questions?.length || 0) + 1
        };
        return true;
    }
    return false;
}

// ==================== UI UPDATES ====================
function updateQuestionCounter() {
    const remaining = state.questions.length - state.usedQuestions.size;
    elements.remainingCount.textContent = remaining;
}

// Recalculate max rows based on current questions
function recalculateMaxRows() {
    const categories = {};
    state.questions.forEach(q => {
        if (!categories[q.Category]) categories[q.Category] = 0;
        categories[q.Category]++;
    });
    const maxRows = state.questions.length > 0 ? Math.max(...Object.values(categories)) : 0;
    
    if (elements.jeopardyRows) {
        elements.jeopardyRows.max = maxRows || 1;
        // If we're at the previous max or if this is the first question, expand to new max
        if (state.jeopardyRows >= state.maxAvailableRows || !state.maxAvailableRows || state.jeopardyRows < 1) {
            state.jeopardyRows = maxRows;
            elements.jeopardyRows.value = maxRows;
        }
        state.maxAvailableRows = maxRows;
    }
    if (elements.maxRowsInfo) {
        elements.maxRowsInfo.textContent = `(max: ${maxRows})`;
    }
}

// Update volume slider UI
function updateVolumeUI() {
    if (elements.volumeSlider) {
        elements.volumeSlider.value = Math.round(state.volume * 100);
    }
    if (elements.volumeLabel) {
        elements.volumeLabel.textContent = `${Math.round(state.volume * 100)}%`;
    }
    if (elements.volumeIcon) {
        if (state.volume === 0) {
            elements.volumeIcon.textContent = '🔇';
        } else if (state.volume < 0.5) {
            elements.volumeIcon.textContent = '🔉';
        } else {
            elements.volumeIcon.textContent = '🔊';
        }
    }
}

// Show confetti animation on correct answer (full feedback mode)
function showConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);
    
    // Create confetti pieces
    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = `${Math.random() * 100}%`;
        confetti.style.animationDelay = `${Math.random() * 0.5}s`;
        confetti.style.animationDuration = `${2 + Math.random() * 2}s`;
        container.appendChild(confetti);
    }
    
    // Remove after animation
    setTimeout(() => container.remove(), 4000);
}

// Add loading state to question card
function setQuestionLoading(loading) {
    if (loading) {
        elements.questionCard.classList.add('loading');
    } else {
        elements.questionCard.classList.remove('loading');
        elements.questionCard.classList.add('fade-in');
        setTimeout(() => elements.questionCard.classList.remove('fade-in'), 300);
    }
}

// Show empty state when no questions
function showEmptyState(container, message = 'No questions loaded') {
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">📝</div>
            <div class="empty-state-title">${message}</div>
            <div class="empty-state-text">Import questions from a JSONL file or load sample questions to get started.</div>
        </div>
    `;
}

// Show error alert to user
function showError(title, message) {
    alert(`${title}\n\n${message}`);
}

function updateTeamInputs() {
    elements.teamNames.innerHTML = '';
    
    for (let i = 0; i < state.teamCount; i++) {
        const div = document.createElement('div');
        div.className = 'form-group';
        div.innerHTML = `
            <input type="text" 
                   class="team-name-input" 
                   data-team="${i}" 
                   value="${state.teams[i]?.name || `Team ${i + 1}`}" 
                   placeholder="Team ${i + 1} name">
        `;
        elements.teamNames.appendChild(div);
    }
    
    // Add event listeners
    document.querySelectorAll('.team-name-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const teamIndex = parseInt(e.target.dataset.team);
            if (state.teams[teamIndex]) {
                state.teams[teamIndex].name = e.target.value;
                updateScoreboard();
                saveState();
            }
        });
    });
}

function updateScoreboard() {
    elements.scoreboard.classList.remove('hidden');
    elements.scoreboardInner.innerHTML = '';
    
    // Show scores for active teams only
    for (let i = 0; i < state.teamCount; i++) {
        const team = state.teams[i];
        const teamDiv = document.createElement('div');
        teamDiv.className = 'team-score';
        teamDiv.innerHTML = `
            <span class="team-name">${team.name}</span>
            <span class="team-points" id="teamScore${i}">${team.score}</span>
        `;
        elements.scoreboardInner.appendChild(teamDiv);
    }
}

function updateAwardButtons() {
    // Update both single mode and modal award buttons
    const containers = [
        { buttons: document.getElementById('singleAwardButtons'), label: document.getElementById('singleAwardLabel'), isModal: false },
        { buttons: document.getElementById('modalAwardButtons'), label: document.getElementById('modalAwardLabel'), isModal: true }
    ];
    
    containers.forEach(({ buttons, label, isModal }) => {
        if (!buttons) return;
        buttons.innerHTML = '';
        
        // Update label
        if (label) {
            label.textContent = state.teamCount <= 1 ? 'Mark as:' : 'Award points to:';
        }
        
        // Use larger buttons for modal
        const btnSize = isModal ? '' : 'btn-small';
        
        if (state.teamCount <= 1) {
            // Solo mode - simple Correct button
            const correctBtn = document.createElement('button');
            correctBtn.className = `btn ${btnSize} btn-success`.trim();
            correctBtn.textContent = '✓ Correct';
            correctBtn.addEventListener('click', () => awardPointsToTeam(0));
            buttons.appendChild(correctBtn);
        } else {
            // Multi-team mode - button per team
            for (let i = 0; i < state.teamCount; i++) {
                const team = state.teams[i];
                const btn = document.createElement('button');
                btn.className = `btn ${btnSize} btn-accent`.trim();
                btn.textContent = team.name;
                btn.addEventListener('click', () => awardPointsToTeam(i));
                buttons.appendChild(btn);
            }
        }
    });
    
    // Also update the footer award buttons for backwards compatibility
    elements.awardButtons.innerHTML = '';
    if (state.teamCount <= 1) {
        const correctBtn = document.createElement('button');
        correctBtn.className = 'btn btn-small btn-success';
        correctBtn.textContent = '✓ Correct';
        correctBtn.addEventListener('click', () => awardPointsToTeam(0));
        elements.awardButtons.appendChild(correctBtn);
    } else {
        for (let i = 0; i < state.teamCount; i++) {
            const team = state.teams[i];
            const btn = document.createElement('button');
            btn.className = 'btn btn-small btn-accent';
            btn.textContent = team.name;
            btn.addEventListener('click', () => awardPointsToTeam(i));
            elements.awardButtons.appendChild(btn);
        }
    }
}

function showAwardButtons() {
    if (state.answerRevealed) {
        updateAwardButtons();
        
        // Show inline award sections based on game mode
        if (state.gameMode === 'jeopardy') {
            // Hide close button, show award section in modal
            const closeSection = document.getElementById('modalCloseSection');
            const awardSection = document.getElementById('modalAwardSection');
            if (closeSection) closeSection.classList.add('hidden');
            if (awardSection) awardSection.classList.remove('hidden');
        } else {
            // Hide next/skip buttons, show award section in single mode
            const questionActions = document.getElementById('questionActions');
            const awardSection = document.getElementById('singleAwardSection');
            if (questionActions) questionActions.classList.add('hidden');
            if (awardSection) awardSection.classList.remove('hidden');
        }
        
        // Also show footer award for backwards compatibility (hidden by CSS if not needed)
        elements.awardPoints.classList.remove('hidden');
        updateAwardLabel();
    }
}

function hideAwardButtons() {
    elements.awardPoints.classList.add('hidden');
    
    // Hide inline award sections and restore original buttons
    const singleAwardSection = document.getElementById('singleAwardSection');
    const questionActions = document.getElementById('questionActions');
    const modalAwardSection = document.getElementById('modalAwardSection');
    const modalCloseSection = document.getElementById('modalCloseSection');
    
    if (singleAwardSection) singleAwardSection.classList.add('hidden');
    if (questionActions) questionActions.classList.remove('hidden');
    if (modalAwardSection) modalAwardSection.classList.add('hidden');
    if (modalCloseSection) modalCloseSection.classList.remove('hidden');
}

function updateAwardLabel() {
    const label = elements.awardPoints.querySelector('.award-label');
    if (label) {
        label.textContent = state.teamCount <= 1 ? 'Mark as:' : 'Award points to:';
    }
}

function awardPointsToTeam(teamIndex) {
    if (!state.currentQuestion) return;
    
    // Use the points that were displayed for this question
    const points = state.currentDisplayedPoints || (state.usePointValues 
        ? (state.currentQuestion.Difficulty === 'L2' ? state.l2Points : state.l1Points)
        : 1);
    
    state.teams[teamIndex].score += points;
    
    // Animate score change
    const scoreEl = document.getElementById(`teamScore${teamIndex}`);
    if (scoreEl) {
        scoreEl.classList.add('score-bump');
        setTimeout(() => scoreEl.classList.remove('score-bump'), 300);
    }
    
    updateScoreboard();
    hideAwardButtons();
    saveState();
    
    // Proceed to next action based on game mode
    proceedAfterAward();
}

function skipAward() {
    hideAwardButtons();
    saveState();
    proceedAfterAward();
}

function proceedAfterAward() {
    if (state.gameMode === 'jeopardy') {
        // Remove ALL descriptions (may be in answersGrid or parent container)
        const parentContainer = elements.modalAnswersGrid.parentElement;
        if (parentContainer) {
            parentContainer.querySelectorAll('.answer-description').forEach(el => el.remove());
        }
        elements.modalAnswersGrid.querySelectorAll('.answer-description').forEach(el => el.remove());
        // Close modal and return to board
        elements.questionModal.classList.add('hidden');
        state.answerRevealed = false;
        state.currentQuestion = null;
        state.currentQuestionIndex = null;
    } else {
        // Single mode - go to next question
        nextQuestion();
    }
}

// ==================== QUESTION LOGIC ====================
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function getRandomUnusedQuestion() {
    const unusedIndices = [];
    state.questions.forEach((_, index) => {
        if (!state.usedQuestions.has(index)) {
            unusedIndices.push(index);
        }
    });
    
    if (unusedIndices.length === 0) return null;
    
    if (state.questionOrder === 'ordered') {
        // Sort unused indices by question ID (ascending order)
        unusedIndices.sort((a, b) => {
            const idA = state.questions[a].QuestionId || a;
            const idB = state.questions[b].QuestionId || b;
            return idA - idB;
        });
        // Return the first (lowest ID) unused question
        const nextIndex = unusedIndices[0];
        return { question: state.questions[nextIndex], index: nextIndex };
    } else {
        // Randomized mode - pick random unused question
        const randomIndex = unusedIndices[Math.floor(Math.random() * unusedIndices.length)];
        return { question: state.questions[randomIndex], index: randomIndex };
    }
}

function displayQuestion(question, index, isModal = false) {
    state.currentQuestion = question;
    state.currentQuestionIndex = index;
    state.answerRevealed = false;
    hideAwardButtons();
    
    const categoryEl = isModal ? elements.modalCategory : elements.currentCategory;
    const difficultyEl = isModal ? elements.modalDifficulty : elements.currentDifficulty;
    const pointsEl = isModal ? elements.modalPoints : elements.currentPoints;
    const questionEl = isModal ? elements.modalQuestionText : elements.questionText;
    const answersEl = isModal ? elements.modalAnswersGrid : elements.answersGrid;
    
    // Remove any existing descriptions from previous question (may be outside answersEl)
    const parentContainer = answersEl.parentElement;
    if (parentContainer) {
        parentContainer.querySelectorAll('.answer-description').forEach(el => el.remove());
    }
    
    categoryEl.textContent = question.Category;
    difficultyEl.textContent = question.Difficulty;
    difficultyEl.className = `difficulty-badge ${question.Difficulty.toLowerCase()}`;
    
    // Use custom points from Jeopardy cell if available, otherwise calculate from difficulty
    let points;
    if (state.currentCustomPoints !== null && state.currentCustomPoints !== undefined) {
        points = state.currentCustomPoints;
    } else {
        points = state.usePointValues 
            ? (question.Difficulty === 'L2' ? state.l2Points : state.l1Points)
            : 1;
    }
    state.currentDisplayedPoints = points;
    pointsEl.textContent = `${points} ${state.usePointValues ? 'pts' : 'pt'}`;
    
    questionEl.textContent = question.Question;
    
    // Get question type - default to multiple_choice if not specified
    // Note: 'general' is the new name for 'regex' type, support both for backwards compatibility
    let questionType = question.Type || 'multiple_choice';
    if (questionType === 'regex') {
        questionType = 'general'; // Normalize old 'regex' type to 'general'
    }
    
    answersEl.innerHTML = '';
    answersEl.classList.remove('many-answers', 'hidden-type', 'general-type');
    
    // Render based on question type
    switch (questionType) {
        case 'hidden':
            renderHiddenQuestion(question, answersEl);
            break;
        case 'general':
            renderGeneralQuestion(question, answersEl);
            break;
        case 'multiple_answer':
            renderMultipleAnswerQuestion(question, answersEl);
            break;
        case 'multiple_choice':
        default:
            renderMultipleChoiceQuestion(question, answersEl);
            break;
    }
    
    if (!isModal) {
        elements.skipQuestionBtn.disabled = false;
    }
}

// ==================== QUESTION TYPE RENDERERS ====================

function renderMultipleChoiceQuestion(question, answersEl) {
    // Determine how many incorrect answers to show based on difficulty (default 3)
    const incorrectCountMap = { easy: 3, medium: 5, hard: 7 };
    const maxIncorrect = incorrectCountMap[state.answerDifficulty] || 3;
    
    // Get available incorrect answers (up to maxIncorrect)
    const availableIncorrect = question.IncorrectAnswers || [];
    const incorrectToShow = shuffleArray([...availableIncorrect]).slice(0, maxIncorrect);
    
    // Use only the first correct answer for multiple_choice
    const correctAnswer = question.Answers[0];
    const allAnswers = [correctAnswer, ...incorrectToShow];
    const shuffledAnswers = shuffleArray(allAnswers);
    
    if (shuffledAnswers.length > 4) {
        answersEl.classList.add('many-answers');
    }
    
    shuffledAnswers.forEach(answer => {
        const btn = document.createElement('button');
        btn.className = 'answer-btn';
        btn.textContent = answer;
        btn.dataset.correct = (answer.toLowerCase() === correctAnswer.toLowerCase()).toString();
        btn.addEventListener('click', () => revealAnswer(btn, answersEl));
        answersEl.appendChild(btn);
    });
}

function renderMultipleAnswerQuestion(question, answersEl) {
    // Determine how many incorrect answers to show based on difficulty
    const incorrectCountMap = { easy: 3, medium: 5, hard: 7 };
    const maxIncorrect = incorrectCountMap[state.answerDifficulty] || 3;
    
    const availableIncorrect = question.IncorrectAnswers || [];
    const incorrectToShow = shuffleArray([...availableIncorrect]).slice(0, maxIncorrect);
    
    // Combine all correct answers with selected incorrect answers
    const allAnswers = [...question.Answers, ...incorrectToShow];
    const shuffledAnswers = shuffleArray(allAnswers);
    
    if (shuffledAnswers.length > 4) {
        answersEl.classList.add('many-answers');
    }
    
    // Add hint for multi-select
    const hint = document.createElement('div');
    hint.className = 'multi-select-hint';
    hint.textContent = `Select all ${question.Answers.length} correct answers, then submit`;
    answersEl.appendChild(hint);
    
    shuffledAnswers.forEach(answer => {
        const btn = document.createElement('button');
        btn.className = 'answer-btn';
        btn.textContent = answer;
        
        const isCorrect = question.Answers.some(a => 
            a.toLowerCase() === answer.toLowerCase()
        );
        btn.dataset.correct = isCorrect;
        btn.addEventListener('click', () => toggleAnswerSelection(btn));
        answersEl.appendChild(btn);
    });
    
    // Add submit button
    const submitBtn = document.createElement('button');
    submitBtn.className = 'submit-answers-btn';
    submitBtn.textContent = 'Submit Answers';
    submitBtn.addEventListener('click', () => submitMultiSelectAnswers(answersEl, question.Answers.length));
    answersEl.appendChild(submitBtn);
}

function renderHiddenQuestion(question, answersEl) {
    answersEl.classList.add('hidden-type');
    
    // Create hidden answer container
    const answerContainer = document.createElement('div');
    answerContainer.className = 'hidden-answer-container';
    
    // Create spoiler blocks for each answer
    const spoilerGrid = document.createElement('div');
    spoilerGrid.className = 'spoiler-grid';
    
    question.Answers.forEach((answer, index) => {
        const spoilerBlock = document.createElement('div');
        spoilerBlock.className = 'spoiler-block';
        spoilerBlock.setAttribute('data-index', index);
        
        const spoilerOverlay = document.createElement('div');
        spoilerOverlay.className = 'spoiler-overlay';
        spoilerOverlay.innerHTML = '<span class="spoiler-icon">🔒</span><span class="spoiler-hint">Click to reveal</span>';
        
        const spoilerContent = document.createElement('div');
        spoilerContent.className = 'spoiler-content';
        spoilerContent.textContent = answer;
        
        spoilerBlock.appendChild(spoilerOverlay);
        spoilerBlock.appendChild(spoilerContent);
        
        // Click to reveal individual answer
        spoilerBlock.addEventListener('click', () => {
            if (!spoilerBlock.classList.contains('revealed')) {
                spoilerBlock.classList.add('revealed');
                playSound('reveal');
            }
        });
        
        spoilerGrid.appendChild(spoilerBlock);
    });
    
    answerContainer.appendChild(spoilerGrid);
    
    // Create the reveal all button
    const revealBtn = document.createElement('button');
    revealBtn.className = 'answer-btn reveal-answer-btn';
    revealBtn.textContent = '🔓 Reveal All Answers';
    revealBtn.addEventListener('click', () => {
        if (state.answerRevealed) return;
        state.answerRevealed = true;
        
        // Reveal all spoiler blocks
        const allSpoilers = spoilerGrid.querySelectorAll('.spoiler-block');
        allSpoilers.forEach(block => block.classList.add('revealed'));
        
        revealBtn.classList.add('hidden');
        
        // Show description if available
        if (question.Description) {
            descEl.classList.remove('hidden');
        }
        
        // Play reveal sound
        playSound('correct');
        
        // Mark question as used
        markQuestionUsed();
        showAwardButtons();
    });
    
    answerContainer.appendChild(revealBtn);
    
    // Add description/notes if available (initially hidden)
    let descEl = null;
    if (question.Description) {
        descEl = document.createElement('div');
        descEl.className = 'answer-description hidden';
        descEl.textContent = question.Description;
        answerContainer.appendChild(descEl);
    }
    
    answersEl.appendChild(answerContainer);
}

function renderGeneralQuestion(question, answersEl) {
    answersEl.classList.add('general-type');
    
    // Validate the regex pattern first (if provided)
    if (question.RegEx) {
        const patternCheck = validateRegexPattern(question.RegEx);
        if (!patternCheck.valid) {
            console.warn(`Invalid regex pattern for question: ${question.Question}`, patternCheck.error);
            // Fall back to multiple choice if regex is invalid
            renderMultipleChoiceQuestion(question, answersEl);
            return;
        }
    }
    
    // Create input container
    const inputContainer = document.createElement('div');
    inputContainer.className = 'general-input-container';
    
    // Add hint if available
    if (question.RegExDescription) {
        const hint = document.createElement('div');
        hint.className = 'general-hint';
        hint.textContent = question.RegExDescription;
        inputContainer.appendChild(hint);
    }
    
    // Create text input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'general-answer-input';
    input.placeholder = 'Type your answer...';
    input.autocomplete = 'off';
    
    // Create submit button
    const submitBtn = document.createElement('button');
    submitBtn.className = 'submit-answers-btn';
    submitBtn.textContent = 'Submit Answer';
    
    // Create result display
    const resultDisplay = document.createElement('div');
    resultDisplay.className = 'general-result hidden';
    
    const handleSubmit = async () => {
        if (state.answerRevealed) return;
        
        const userAnswer = input.value.trim();
        if (!userAnswer) {
            input.classList.add('shake');
            setTimeout(() => input.classList.remove('shake'), 500);
            return;
        }
        
        state.answerRevealed = true;
        input.disabled = true;
        submitBtn.disabled = true;
        
        // Validate answer - use regex if provided, otherwise case-insensitive string match
        let isCorrect = false;
        if (question.RegEx) {
            const result = await validateRegexAnswer(userAnswer, question.RegEx);
            isCorrect = result.matched;
        } else {
            // Fallback: case-insensitive match against any accepted answer
            isCorrect = question.Answers.some(a => 
                a.toLowerCase().trim() === userAnswer.toLowerCase()
            );
        }
        
        playSound(isCorrect ? 'correct' : 'wrong');
        
        if (isCorrect && state.feedbackIntensity === 'full') {
            showConfetti();
        }
        
        // Show result
        resultDisplay.classList.remove('hidden');
        resultDisplay.innerHTML = `
            <div class="result-status ${isCorrect ? 'correct' : 'incorrect'}">
                ${isCorrect ? '✓ Correct!' : '✗ Incorrect'}
            </div>
            <div class="correct-answer">
                <strong>Answer:</strong> ${question.Answers.join(', ')}
            </div>
            ${!isCorrect && question.Description ? `
                <div class="answer-description incorrect-explanation">
                    <strong>💡 Explanation:</strong> ${escapeHtml(question.Description)}
                </div>
            ` : ''}
        `;
        
        input.classList.add(isCorrect ? 'correct' : 'incorrect');
        
        markQuestionUsed();
        showAwardButtons();
    };
    
    submitBtn.addEventListener('click', handleSubmit);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSubmit();
    });
    
    inputContainer.appendChild(input);
    inputContainer.appendChild(submitBtn);
    inputContainer.appendChild(resultDisplay);
    answersEl.appendChild(inputContainer);
    
    // Focus the input
    setTimeout(() => input.focus(), 100);
}

// Helper function to mark question as used (extracted from reveal functions)
function markQuestionUsed() {
    if (state.currentQuestionIndex !== null) {
        state.usedQuestions.add(state.currentQuestionIndex);
        updateQuestionCounter();
        saveState();
        
        // Update Jeopardy cell if in that mode
        if (state.gameMode === 'jeopardy') {
            const cell = document.querySelector(`[data-question-index="${state.currentQuestionIndex}"]`);
            if (cell) {
                cell.classList.add('used');
            }
        }
    }
}

function toggleAnswerSelection(btn) {
    if (state.answerRevealed) return;
    btn.classList.toggle('selected');
}

function submitMultiSelectAnswers(container, correctCount) {
    if (state.answerRevealed) return;
    state.answerRevealed = true;
    
    const selectedBtns = container.querySelectorAll('.answer-btn.selected');
    const allBtns = container.querySelectorAll('.answer-btn');
    const intensity = state.feedbackIntensity;
    
    // Count correct and incorrect selections
    let correctSelections = 0;
    let incorrectSelections = 0;
    
    selectedBtns.forEach(btn => {
        if (btn.dataset.correct === 'true') {
            correctSelections++;
        } else {
            incorrectSelections++;
        }
    });
    
    // Check if all correct answers are selected and no incorrect ones
    const isFullyCorrect = correctSelections === correctCount && incorrectSelections === 0;
    
    // Play sound based on result
    playSound(isFullyCorrect ? 'correct' : 'wrong');
    
    // Show confetti on fully correct with full feedback
    if (isFullyCorrect && intensity === 'full') {
        showConfetti();
    }
    
    // Mark all buttons
    allBtns.forEach(btn => {
        btn.disabled = true;
        const isCorrect = btn.dataset.correct === 'true';
        const isSelected = btn.classList.contains('selected');
        
        if (isCorrect) {
            // Correct answer - always show as correct
            btn.classList.add('correct', `feedback-${intensity}`);
            if (!isSelected) {
                // Missed correct answer - add visual indicator
                btn.style.opacity = '0.7';
            }
        } else if (isSelected) {
            // Incorrect answer that was selected
            btn.classList.add('incorrect', `feedback-${intensity}`);
        }
    });
    
    // Disable submit button
    const submitBtn = container.querySelector('.submit-answers-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = isFullyCorrect ? '✓ All Correct!' : `${correctSelections}/${correctCount} Correct`;
    }
    
    // Show description to help with learning (for all answers)
    if (state.currentQuestion?.Description) {
        showDescriptionAfterAnswer(container, state.currentQuestion.Description, isFullyCorrect);
    }
    
    // Mark question as used
    markQuestionUsed();
    showAwardButtons();
}

function revealAnswer(clickedBtn, container) {
    if (state.answerRevealed) return;
    state.answerRevealed = true;
    
    const isCorrect = clickedBtn.dataset.correct === 'true';
    const intensity = state.feedbackIntensity;
    
    // Mark the clicked button
    clickedBtn.classList.add(isCorrect ? 'correct' : 'incorrect');
    clickedBtn.classList.add(`feedback-${intensity}`);
    
    // Play sound
    playSound(isCorrect ? 'correct' : 'wrong');
    
    // Show confetti on correct answer with full feedback
    if (isCorrect && intensity === 'full') {
        showConfetti();
    }
    
    // Reveal all correct answers
    container.querySelectorAll('.answer-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.correct === 'true' && btn !== clickedBtn) {
            btn.classList.add('correct', `feedback-${intensity}`);
        }
    });
    
    // Show description to help with learning (for all answers)
    if (state.currentQuestion?.Description) {
        showDescriptionAfterAnswer(container, state.currentQuestion.Description, isCorrect);
    }
    
    // Mark question as used
    markQuestionUsed();
    showAwardButtons();
}

// Show description after answer is revealed (for learning purposes)
function showDescriptionAfterAnswer(container, description, isCorrect = false) {
    // Check if description element already exists
    let descEl = container.parentElement.querySelector('.answer-description');
    if (!descEl) {
        // Create new description element
        descEl = document.createElement('div');
        descEl.className = 'answer-description';
        container.parentElement.appendChild(descEl);
    }
    // Add class based on correctness for styling
    descEl.classList.toggle('correct-explanation', isCorrect);
    descEl.classList.toggle('incorrect-explanation', !isCorrect);
    
    const icon = isCorrect ? '✨' : '💡';
    const prefix = isCorrect ? 'Learn more:' : 'Explanation:';
    descEl.innerHTML = `<strong>${icon} ${prefix}</strong> ${escapeHtml(description)}`;
    descEl.classList.remove('hidden');
}

// Legacy wrapper for backwards compatibility
function showDescriptionAfterIncorrect(container, description) {
    showDescriptionAfterAnswer(container, description, false);
}

function nextQuestion() {
    initAudio(); // Initialize audio on user interaction
    
    state.currentCustomPoints = null; // Reset custom points for single mode
    
    // Show loading state
    setQuestionLoading(true);
    
    // Small delay for visual feedback
    setTimeout(() => {
        const result = getRandomUnusedQuestion();
        if (!result) {
            setQuestionLoading(false);
            elements.questionText.textContent = "No more questions! Import more or reset.";
            elements.answersGrid.innerHTML = '';
            elements.skipQuestionBtn.disabled = true;
            return;
        }
        
        displayQuestion(result.question, result.index);
        setQuestionLoading(false);
    }, 150);
}

function skipQuestion() {
    nextQuestion();
}

// ==================== JEOPARDY BOARD ====================
function buildJeopardyBoard() {
    if (state.questions.length === 0) {
        showEmptyState(elements.jeopardyBoard, 'No questions loaded');
        return;
    }
    
    // Group questions by category, tracking first appearance order
    const categories = {};
    const categoryOrder = []; // Track order of first appearance
    state.questions.forEach((q, index) => {
        if (!categories[q.Category]) {
            categories[q.Category] = [];
            categoryOrder.push(q.Category);
        }
        categories[q.Category].push({ question: q, index });
    });
    
    // Get category names based on order setting
    let categoryNames;
    if (state.questionOrder === 'ordered') {
        // Use import order (first appearance)
        categoryNames = categoryOrder;
    } else {
        // Randomize category order
        categoryNames = shuffleArray(Object.keys(categories));
    }
    
    // Always sort questions within each category by Difficulty (L1 at top, L5 at bottom)
    // This ensures proper ordering in Jeopardy mode
    for (const cat of categoryNames) {
        categories[cat].sort((a, b) => {
            // Extract numeric part from Difficulty (e.g., "L1" -> 1, "L2" -> 2)
            const diffA = parseInt((a.question.Difficulty || 'L1').replace(/\D/g, '')) || 1;
            const diffB = parseInt((b.question.Difficulty || 'L1').replace(/\D/g, '')) || 1;
            if (diffA !== diffB) {
                return diffA - diffB; // Lower difficulty first (L1 at top, L5 at bottom)
            }
            // If same difficulty, sort by QuestionId as secondary sort
            const idA = a.question.QuestionId || a.index;
            const idB = b.question.QuestionId || b.index;
            return idA - idB;
        });
    }
    
    // Determine max available rows based on questions
    const maxQuestionsPerCategory = Math.max(...categoryNames.map(cat => categories[cat].length));
    const previousMax = state.maxAvailableRows || 0;
    state.maxAvailableRows = maxQuestionsPerCategory;
    
    // Update the UI to show max available
    if (elements.jeopardyRows) {
        elements.jeopardyRows.max = maxQuestionsPerCategory;
        // Auto-adjust rows: if current is higher than max, reduce
        if (state.jeopardyRows > maxQuestionsPerCategory) {
            state.jeopardyRows = maxQuestionsPerCategory;
            elements.jeopardyRows.value = maxQuestionsPerCategory;
        }
        // Auto-expand when: we're at previous max, or starting from 1 (likely new/empty board), or rows increased
        if (state.jeopardyRows >= previousMax || state.jeopardyRows <= 1 || maxQuestionsPerCategory > previousMax) {
            state.jeopardyRows = maxQuestionsPerCategory;
            elements.jeopardyRows.value = maxQuestionsPerCategory;
        }
    }
    if (elements.maxRowsInfo) {
        elements.maxRowsInfo.textContent = `(max: ${maxQuestionsPerCategory})`;
    }
    
    // Use the lesser of requested rows or available questions
    const numRows = Math.min(state.jeopardyRows, maxQuestionsPerCategory);
    
    // If numRows is 0, default to showing all available rows
    const actualRows = numRows > 0 ? numRows : maxQuestionsPerCategory;
    
    // Point values for each row (scales based on base points)
    const basePoints = state.l1Points;
    
    elements.jeopardyBoard.innerHTML = '';
    elements.jeopardyBoard.style.setProperty('--category-count', categoryNames.length + 1); // +1 for row label column
    
    // Create header row
    const headerRow = document.createElement('div');
    headerRow.className = 'jeopardy-row header-row';
    
    // Add empty corner cell
    const cornerCell = document.createElement('div');
    cornerCell.className = 'jeopardy-cell corner-cell';
    cornerCell.textContent = '';
    headerRow.appendChild(cornerCell);
    
    categoryNames.forEach(cat => {
        const cell = document.createElement('div');
        cell.className = 'jeopardy-cell header-cell';
        cell.textContent = cat.toUpperCase();
        headerRow.appendChild(cell);
    });
    elements.jeopardyBoard.appendChild(headerRow);
    
    // Shuffle questions within each category ONLY if randomized mode
    // In ordered mode, keep the difficulty-based sort order
    const orderedCategories = {};
    categoryNames.forEach(cat => {
        if (state.questionOrder === 'ordered') {
            orderedCategories[cat] = [...categories[cat]]; // Keep sorted order
        } else {
            orderedCategories[cat] = shuffleArray([...categories[cat]]); // Randomize
        }
    });
    
    // Create rows for each point value
    const animations = ['springIn', 'bounceIn', 'flipIn', 'slideInLeft', 'slideInRight', 'slideInUp'];
    
    for (let rowIndex = 0; rowIndex < actualRows; rowIndex++) {
        const row = document.createElement('div');
        row.className = 'jeopardy-row';
        
        // Points scale by row: row 1 = base, row 2 = 2x base, etc.
        const points = state.usePointValues ? basePoints * (rowIndex + 1) : 1;
        
        // Add row label cell on the left (numbered)
        const rowLabelCell = document.createElement('div');
        rowLabelCell.className = 'jeopardy-cell row-label-cell';
        rowLabelCell.textContent = rowIndex + 1;
        row.appendChild(rowLabelCell);
        
        categoryNames.forEach((cat, colIndex) => {
            const cell = document.createElement('div');
            cell.className = 'jeopardy-cell value-cell';
            cell.dataset.category = cat; // Store category for reference
            
            const categoryQuestions = orderedCategories[cat];
            
            if (rowIndex < categoryQuestions.length) {
                const questionData = categoryQuestions[rowIndex];
                cell.dataset.questionIndex = questionData.index;
                cell.dataset.points = points;
                
                // Get the question's subcategory if different from column category
                const qCategory = questionData.question.Category;
                const showSubcategory = qCategory !== cat;
                const categoryLabel = showSubcategory ? `<span class="cell-category-label">${qCategory}</span>` : '';
                
                // Apply custom point display based on settings
                if (state.pointImageMode === 'fullcell' && state.pointImageUrl) {
                    // Full cell background image
                    cell.classList.add('image-fullcell');
                    cell.style.backgroundImage = `url('${state.pointImageUrl}')`;
                    cell.innerHTML = `${categoryLabel}<span class="cell-points-overlay">${formatPointDisplay(points)}</span>`;
                } else if (state.pointImageMode === 'replace' && state.pointImageUrl) {
                    // Image replaces text
                    cell.innerHTML = `${categoryLabel}<img src="${state.pointImageUrl}" alt="${points}" class="cell-point-image"><span class="cell-points-small">${points}</span>`;
                } else {
                    // Text only (default or custom label)
                    cell.innerHTML = `${categoryLabel}<span class="cell-points-text">${formatPointDisplay(points)}</span>`;
                }
                
                if (state.usedQuestions.has(questionData.index)) {
                    cell.classList.add('used');
                }
                
                // Random animation
                const randomAnim = animations[Math.floor(Math.random() * animations.length)];
                cell.style.animation = `${randomAnim} 0.5s ease-out forwards`;
                cell.style.animationDelay = `${(colIndex * 0.08) + (rowIndex * 0.15)}s`;
                
                cell.addEventListener('click', () => openJeopardyQuestion(questionData.index, points));
            } else {
                cell.textContent = '-';
                cell.classList.add('empty');
            }
            
            row.appendChild(cell);
        });
        
        elements.jeopardyBoard.appendChild(row);
    }
}

// Format point display based on settings
function formatPointDisplay(points) {
    if (state.pointLabel && state.pointLabel.trim()) {
        return `${points} ${state.pointLabel}`;
    }
    return state.usePointValues ? `${points} pt` : '1 pt';
}

function openJeopardyQuestion(index, customPoints = null) {
    if (state.usedQuestions.has(index)) return;
    
    const question = state.questions[index];
    state.currentCustomPoints = customPoints;
    displayQuestion(question, index, true);
    elements.questionModal.classList.remove('hidden');
}

function closeModal() {
    // Remove ALL descriptions (may be in answersGrid or parent container)
    const parentContainer = elements.modalAnswersGrid.parentElement;
    if (parentContainer) {
        parentContainer.querySelectorAll('.answer-description').forEach(el => el.remove());
    }
    elements.modalAnswersGrid.querySelectorAll('.answer-description').forEach(el => el.remove());
    elements.questionModal.classList.add('hidden');
    hideAwardButtons();
    state.answerRevealed = false;
    state.currentQuestion = null;
    state.currentQuestionIndex = null;
}

// ==================== IMPORT/EXPORT ====================
// Generate MD5 hash from question + answers for deduplication
function generateQuestionId(q) {
    const question = (q.Question || '').trim().toLowerCase();
    const answers = (q.Answers || []).map(a => a.trim().toLowerCase()).sort().join('|');
    const content = question + '::' + answers;
    
    // Simple MD5 implementation
    function md5(string) {
        function rotateLeft(val, shift) {
            return (val << shift) | (val >>> (32 - shift));
        }
        function addUnsigned(x, y) {
            const x8 = x & 0x80000000, y8 = y & 0x80000000;
            const x4 = x & 0x40000000, y4 = y & 0x40000000;
            const result = (x & 0x3FFFFFFF) + (y & 0x3FFFFFFF);
            if (x4 & y4) return result ^ 0x80000000 ^ x8 ^ y8;
            if (x4 | y4) {
                if (result & 0x40000000) return result ^ 0xC0000000 ^ x8 ^ y8;
                return result ^ 0x40000000 ^ x8 ^ y8;
            }
            return result ^ x8 ^ y8;
        }
        function f(x, y, z) { return (x & y) | (~x & z); }
        function g(x, y, z) { return (x & z) | (y & ~z); }
        function h(x, y, z) { return x ^ y ^ z; }
        function i(x, y, z) { return y ^ (x | ~z); }
        function ff(a, b, c, d, x, s, ac) { return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, f(b, c, d)), addUnsigned(x, ac)), s), b); }
        function gg(a, b, c, d, x, s, ac) { return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, g(b, c, d)), addUnsigned(x, ac)), s), b); }
        function hh(a, b, c, d, x, s, ac) { return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, h(b, c, d)), addUnsigned(x, ac)), s), b); }
        function ii(a, b, c, d, x, s, ac) { return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, i(b, c, d)), addUnsigned(x, ac)), s), b); }
        function convertToWordArray(str) {
            const len = str.length, numWords = ((len + 8 - ((len + 8) % 64)) / 64 + 1) * 16;
            const words = new Array(numWords - 1).fill(0);
            let pos = 0;
            for (let i = 0; i < len; i++) {
                const wordNum = (i - (i % 4)) / 4;
                pos = (i % 4) * 8;
                words[wordNum] |= str.charCodeAt(i) << pos;
            }
            words[(len - (len % 4)) / 4] |= 0x80 << ((len % 4) * 8);
            words[numWords - 2] = len << 3;
            words[numWords - 1] = len >>> 29;
            return words;
        }
        function wordToHex(val) {
            let hex = '';
            for (let i = 0; i <= 3; i++) hex += ((val >>> (i * 8)) & 255).toString(16).padStart(2, '0');
            return hex;
        }
        const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
        const K = [
            0xD76AA478, 0xE8C7B756, 0x242070DB, 0xC1BDCEEE, 0xF57C0FAF, 0x4787C62A, 0xA8304613, 0xFD469501,
            0x698098D8, 0x8B44F7AF, 0xFFFF5BB1, 0x895CD7BE, 0x6B901122, 0xFD987193, 0xA679438E, 0x49B40821,
            0xF61E2562, 0xC040B340, 0x265E5A51, 0xE9B6C7AA, 0xD62F105D, 0x02441453, 0xD8A1E681, 0xE7D3FBC8,
            0x21E1CDE6, 0xC33707D6, 0xF4D50D87, 0x455A14ED, 0xA9E3E905, 0xFCEFA3F8, 0x676F02D9, 0x8D2A4C8A,
            0xFFFA3942, 0x8771F681, 0x6D9D6122, 0xFDE5380C, 0xA4BEEA44, 0x4BDECFA9, 0xF6BB4B60, 0xBEBFBC70,
            0x289B7EC6, 0xEAA127FA, 0xD4EF3085, 0x04881D05, 0xD9D4D039, 0xE6DB99E5, 0x1FA27CF8, 0xC4AC5665,
            0xF4292244, 0x432AFF97, 0xAB9423A7, 0xFC93A039, 0x655B59C3, 0x8F0CCC92, 0xFFEFF47D, 0x85845DD1,
            0x6FA87E4F, 0xFE2CE6E0, 0xA3014314, 0x4E0811A1, 0xF7537E82, 0xBD3AF235, 0x2AD7D2BB, 0xEB86D391
        ];
        const words = convertToWordArray(unescape(encodeURIComponent(string)));
        let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
        for (let k = 0; k < words.length; k += 16) {
            const AA = a, BB = b, CC = c, DD = d;
            for (let j = 0; j < 64; j++) {
                let fn, idx;
                if (j < 16) { fn = ff; idx = j; }
                else if (j < 32) { fn = gg; idx = (5 * j + 1) % 16; }
                else if (j < 48) { fn = hh; idx = (3 * j + 5) % 16; }
                else { fn = ii; idx = (7 * j) % 16; }
                const temp = d; d = c; c = b;
                b = fn(a, b, c, temp, words[k + idx], S[Math.floor(j / 16) * 4 + (j % 4)], K[j]);
                a = temp;
            }
            a = addUnsigned(a, AA); b = addUnsigned(b, BB); c = addUnsigned(c, CC); d = addUnsigned(d, DD);
        }
        return wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
    }
    
    return md5(content);
}

function cleanValue(val) {
    if (typeof val === 'string') {
        // Remove Excel-style ="..." wrapping
        if (val.startsWith('="') && val.endsWith('"')) {
            val = val.slice(2, -1);
        }
        // Remove leading/trailing quotes if doubled
        val = val.replace(/^""|""$/g, '"');
        // Unescape escaped quotes
        val = val.replace(/""/g, '"');
    }
    return val;
}

function cleanQuestion(q) {
    // Normalize type - convert 'regex' to 'general' for backwards compatibility
    let qType = cleanValue(q.Type || 'multiple_choice');
    if (qType === 'regex') {
        qType = 'general';
    }
    
    const cleaned = {
        QuestionId: q.QuestionId || state.nextQuestionId++,
        Category: cleanValue(q.Category || ''),
        Difficulty: cleanValue(q.Difficulty || 'L1'),
        Type: qType,
        Question: cleanValue(q.Question || ''),
        Answers: (q.Answers || []).map(a => cleanValue(a)),
        IncorrectAnswers: (q.IncorrectAnswers || []).map(a => cleanValue(a)),
        Description: cleanValue(q.Description || ''),
        RegEx: cleanValue(q.RegEx || ''),
        RegExDescription: cleanValue(q.RegExDescription || '')
    };
    
    // Use normalized question text as ID for deduplication
    cleaned.id = generateQuestionId(cleaned);
    return cleaned;
}

function parseJSONL(text, existingIds = new Set()) {
    const lines = text.trim().split('\n');
    const questions = [];
    let duplicatesSkipped = 0;
    
    lines.forEach(line => {
        try {
            if (line.trim()) {
                const parsed = JSON.parse(line);
                const cleaned = cleanQuestion(parsed);
                
                // Skip if this question ID already exists
                if (existingIds.has(cleaned.id)) {
                    duplicatesSkipped++;
                    return;
                }
                
                existingIds.add(cleaned.id);
                questions.push(cleaned);
            }
        } catch (e) {
            console.warn('Failed to parse line:', line, e);
        }
    });
    
    if (duplicatesSkipped > 0) {
        console.log(`Skipped ${duplicatesSkipped} duplicate questions`);
    }
    
    return questions;
}

function exportToJSONL() {
    // Export with consistent field order matching Template.jsonl
    const lines = state.questions.map(q => {
        const ordered = {
            id: q.id,
            QuestionId: q.QuestionId,
            Difficulty: q.Difficulty,
            Category: q.Category,
            Type: q.Type,
            Description: q.Description || '',
            Question: q.Question,
            Answers: q.Answers,
            IncorrectAnswers: q.IncorrectAnswers || [],
            RegEx: q.RegEx || '',
            RegExDescription: q.RegExDescription || ''
        };
        return JSON.stringify(ordered);
    });
    const content = lines.join('\n');
    
    const blob = new Blob([content], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'questions.jsonl';
    a.click();
    
    URL.revokeObjectURL(url);
}

function importFromFile(file) {
    const reader = new FileReader();
    
    reader.onerror = () => {
        showError('Import Error', 'Failed to read the file. Please try again.');
    };
    
    reader.onload = (e) => {
        try {
            const content = e.target.result;
            
            if (!content || content.trim().length === 0) {
                showError('Import Error', 'The file appears to be empty.');
                return;
            }
            
            // Build set of existing question IDs for deduplication
            const existingIds = new Set(state.questions.map(q => q.id).filter(id => id));
            const questions = parseJSONL(content, existingIds);
            
            if (questions.length === 0) {
                showError('Import Error', 'No valid questions found in the file (or all were duplicates). Please check the JSONL format.');
                return;
            }
            
            state.questions = [...state.questions, ...questions];
            state.usedQuestions.clear();
            
            // Recalculate max rows and update if needed
            const categories = {};
            state.questions.forEach(q => {
                if (!categories[q.Category]) categories[q.Category] = 0;
                categories[q.Category]++;
            });
            const maxRows = Math.max(...Object.values(categories));
            if (elements.jeopardyRows) {
                elements.jeopardyRows.max = maxRows;
                // If current rows is at or near max, expand to new max
                if (state.jeopardyRows >= state.maxAvailableRows || !state.maxAvailableRows) {
                    state.jeopardyRows = maxRows;
                    elements.jeopardyRows.value = maxRows;
                }
            }
            
            updateQuestionCounter();
            if (state.gameMode === 'jeopardy') {
                buildJeopardyBoard();
            }
            saveState();
            alert(`Successfully imported ${questions.length} questions!`);
        } catch (error) {
            console.error('Import error:', error);
            showError('Import Error', 'Failed to parse the file. Please ensure it is a valid JSONL file.');
        }
    };
    reader.readAsText(file);
}

function loadSampleQuestions() {
    // Clean sample questions and add IDs
    const cleanedSamples = sampleQuestions.map(q => cleanQuestion(q));
    
    // Build existing IDs for deduplication
    const existingIds = new Set(state.questions.map(q => q.id).filter(id => id));
    
    // Filter out duplicates
    const newQuestions = cleanedSamples.filter(q => {
        if (existingIds.has(q.id)) {
            return false;
        }
        existingIds.add(q.id);
        return true;
    });
    
    if (newQuestions.length === 0) {
        alert('Sample questions are already loaded!');
        return;
    }
    
    state.questions = [...state.questions, ...newQuestions];
    state.usedQuestions.clear();
    updateQuestionCounter();
    if (state.gameMode === 'jeopardy') {
        buildJeopardyBoard();
    }
    saveState();
    alert(`Loaded ${newQuestions.length} sample questions!`);
}

// ==================== SERVER CATEGORIES ====================
const API_BASE = '/api';

async function openCategoriesModal() {
    elements.categoriesModal.classList.remove('hidden');
    await loadServerCategories();
}

function closeCategoriesModal() {
    elements.categoriesModal.classList.add('hidden');
}

async function loadServerCategories() {
    // Show loading state
    elements.categoriesLoading.classList.remove('hidden');
    elements.categoriesError.classList.add('hidden');
    elements.categoriesList.classList.add('hidden');
    
    try {
        const response = await fetch(`${API_BASE}/categories`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to load categories');
        }
        
        // Hide loading, show categories
        elements.categoriesLoading.classList.add('hidden');
        elements.categoriesList.classList.remove('hidden');
        
        // Render categories
        renderCategories(data.categories);
        
        // Load and show stats
        await loadServerStats();
        
    } catch (error) {
        console.error('Failed to load categories:', error);
        elements.categoriesLoading.classList.add('hidden');
        elements.categoriesError.classList.remove('hidden');
        elements.categoriesError.querySelector('.error-message').textContent = 
            error.message || 'Failed to load categories. Make sure you are using the Docker deployment.';
    }
}

function renderCategories(categories) {
    elements.categoriesList.innerHTML = '';
    
    if (categories.length === 0) {
        elements.categoriesList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-title">No Categories Available</div>
                <div class="empty-state-text">No question categories found on the server.</div>
            </div>
        `;
        return;
    }
    
    categories.forEach(category => {
        const card = document.createElement('div');
        card.className = 'category-card';
        card.innerHTML = `
            <div class="category-header">
                <h3 class="category-name">${escapeHtml(category.name)}</h3>
                <span class="category-count">${category.questionCount} questions</span>
            </div>
            ${category.subcategories.length > 0 ? `
                <div class="category-subcategories">
                    ${category.subcategories.slice(0, 8).map(sub => 
                        `<span class="subcategory-tag">${escapeHtml(sub.name)} (${sub.count})</span>`
                    ).join('')}
                    ${category.subcategories.length > 8 ? `<span class="subcategory-tag">+${category.subcategories.length - 8} more</span>` : ''}
                </div>
            ` : ''}
            <div class="category-actions">
                <button class="btn btn-secondary btn-small" onclick="previewCategory(${category.id}, '${escapeHtml(category.name)}')">Preview</button>
                <button class="btn btn-primary btn-small" onclick="importCategory(${category.id}, '${escapeHtml(category.name)}')">Import All</button>
            </div>
        `;
        elements.categoriesList.appendChild(card);
    });
}

async function loadServerStats() {
    try {
        const response = await fetch(`${API_BASE}/stats`);
        const data = await response.json();
        
        if (data.success) {
            elements.serverStats.innerHTML = `
                <div class="stat-item">
                    <span>Categories:</span>
                    <span class="stat-value">${data.stats.totalCategories}</span>
                </div>
                <div class="stat-item">
                    <span>Total Questions:</span>
                    <span class="stat-value">${data.stats.totalQuestions}</span>
                </div>
                <div class="stat-item">
                    <span>L1:</span>
                    <span class="stat-value">${data.stats.difficulties.L1 || 0}</span>
                </div>
                <div class="stat-item">
                    <span>L2:</span>
                    <span class="stat-value">${data.stats.difficulties.L2 || 0}</span>
                </div>
            `;
        }
    } catch (error) {
        console.warn('Failed to load server stats:', error);
    }
}

async function previewCategory(categoryId, categoryName) {
    try {
        const response = await fetch(`${API_BASE}/categories/${categoryId}/questions?limit=5`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error);
        }
        
        const previewText = data.questions.slice(0, 5).map((q, i) => 
            `${i + 1}. ${q.Question.substring(0, 100)}${q.Question.length > 100 ? '...' : ''}`
        ).join('\n');
        
        alert(`Preview of "${categoryName}" (${data.count} questions):\n\n${previewText}\n\n...and ${Math.max(0, data.count - 5)} more questions.`);
        
    } catch (error) {
        showError('Preview Error', error.message || 'Failed to preview category');
    }
}

async function importCategory(categoryId, categoryName) {
    const card = event.target.closest('.category-card');
    const actionsDiv = card.querySelector('.category-actions');
    
    // Show loading state
    const originalContent = actionsDiv.innerHTML;
    actionsDiv.innerHTML = `
        <div class="import-progress">
            <div class="loading-spinner"></div>
            <span class="import-progress-text">Importing...</span>
        </div>
    `;
    
    try {
        const response = await fetch(`${API_BASE}/categories/${categoryId}/questions`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error);
        }
        
        if (data.questions.length === 0) {
            throw new Error('No questions found in this category');
        }
        
        // Build set of existing question IDs for deduplication
        const existingIds = new Set(state.questions.map(q => q.id).filter(id => id));
        
        // Clean and deduplicate incoming questions
        let duplicatesSkipped = 0;
        const newQuestions = data.questions.filter(q => {
            const cleaned = cleanQuestion(q);
            if (existingIds.has(cleaned.id)) {
                duplicatesSkipped++;
                return false;
            }
            existingIds.add(cleaned.id);
            // Update the question with the cleaned version including id
            Object.assign(q, cleaned);
            return true;
        });
        
        if (newQuestions.length === 0) {
            throw new Error('All questions in this category are already imported');
        }
        
        // Add questions to state
        state.questions = [...state.questions, ...newQuestions];
        state.usedQuestions.clear();
        
        // Recalculate max rows
        const categories = {};
        state.questions.forEach(q => {
            if (!categories[q.Category]) categories[q.Category] = 0;
            categories[q.Category]++;
        });
        const maxRows = Math.max(...Object.values(categories));
        if (elements.jeopardyRows) {
            elements.jeopardyRows.max = maxRows;
            if (state.jeopardyRows >= state.maxAvailableRows || !state.maxAvailableRows) {
                state.jeopardyRows = maxRows;
                elements.jeopardyRows.value = maxRows;
            }
        }
        
        updateQuestionCounter();
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
        
        // Show success
        actionsDiv.innerHTML = `
            <span style="color: var(--success); font-size: 0.75rem;">✓ Imported ${data.count} questions!</span>
        `;
        
        // Restore buttons after delay
        setTimeout(() => {
            actionsDiv.innerHTML = originalContent;
        }, 3000);
        
    } catch (error) {
        console.error('Import error:', error);
        actionsDiv.innerHTML = originalContent;
        showError('Import Error', error.message || 'Failed to import category');
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== ADD QUESTION ====================
function addQuestion(e) {
    e.preventDefault();
    
    let category = document.getElementById('newCategory').value.trim();
    const difficulty = document.getElementById('newDifficulty').value;
    const questionType = document.getElementById('newType').value;
    
    // Normalize category to match existing categories (case-insensitive)
    const existingCategory = state.questions.find(q => 
        q.Category.toLowerCase() === category.toLowerCase()
    );
    if (existingCategory) {
        category = existingCategory.Category; // Use existing casing
    }
    const question = document.getElementById('newQuestion').value.trim();
    const description = document.getElementById('newDescription').value.trim();
    const answers = document.getElementById('newAnswers').value.split(',').map(a => a.trim()).filter(a => a);
    const incorrect = document.getElementById('newIncorrect').value.split(',').map(a => a.trim()).filter(a => a);
    const regex = document.getElementById('newRegex').value.trim();
    const regexDescription = document.getElementById('newRegexDescription').value.trim();
    
    // Validate based on question type
    if (questionType === 'multiple_choice' || questionType === 'multiple_answer') {
        if (incorrect.length < 3 || incorrect.length > 7) {
            alert('Please provide between 3 and 7 incorrect answers.');
            return;
        }
    }
    
    if (questionType === 'general' && regex) {
        const validation = validateRegexPattern(regex);
        if (!validation.valid) {
            alert(`Invalid regex pattern: ${validation.error}`);
            return;
        }
    }
    
    const newQ = {
        QuestionId: state.nextQuestionId++,
        Category: category,
        Difficulty: difficulty,
        Type: questionType,
        Question: question,
        Answers: answers,
        IncorrectAnswers: incorrect,
        Description: description || '',
        RegEx: (questionType === 'general' && regex) ? regex : '',
        RegExDescription: (questionType === 'general' && regex && regexDescription) ? regexDescription : ''
    };
    
    // Generate ID based on content hash for deduplication
    newQ.id = generateQuestionId(newQ);
    
    state.questions.push(newQ);
    
    // Recalculate max rows and auto-expand if needed
    recalculateMaxRows();
    
    updateQuestionCounter();
    if (state.gameMode === 'jeopardy') {
        buildJeopardyBoard();
    }
    saveState();
    
    // Reset form and close modal
    e.target.reset();
    resetAddQuestionForm();
    closeAddQuestionModal();
    alert('Question added!');
}

function resetAddQuestionForm() {
    // Reset visibility of conditional fields
    if (elements.regexGroup) elements.regexGroup.classList.add('hidden');
    if (elements.regexDescGroup) elements.regexDescGroup.classList.add('hidden');
    if (elements.incorrectAnswersGroup) elements.incorrectAnswersGroup.classList.remove('hidden');
    if (elements.newType) elements.newType.value = 'multiple_choice';
}

function handleQuestionTypeChange(e) {
    const type = e.target.value;
    
    // Show/hide regex fields (for 'general' type)
    const showRegex = type === 'general';
    if (elements.regexGroup) elements.regexGroup.classList.toggle('hidden', !showRegex);
    if (elements.regexDescGroup) elements.regexDescGroup.classList.toggle('hidden', !showRegex);
    
    // Show/hide incorrect answers (not needed for hidden or general)
    const showIncorrect = type === 'multiple_choice' || type === 'multiple_answer';
    if (elements.incorrectAnswersGroup) elements.incorrectAnswersGroup.classList.toggle('hidden', !showIncorrect);
    
    // Update required attribute
    const incorrectInput = document.getElementById('newIncorrect');
    if (incorrectInput) {
        incorrectInput.required = showIncorrect;
    }
}

function handleRegexTemplateChange(e) {
    const template = e.target.value;
    const regexInput = document.getElementById('newRegex');
    const answersInput = document.getElementById('newAnswers');
    
    if (!template || !regexInput) return;
    
    const answer = answersInput ? answersInput.value.split(',')[0].trim() : '';
    
    // If no answer entered yet, show placeholder with instructions
    if (!answer) {
        const placeholders = {
            'number': '^67$',
            'numberOrWord': '^(67|sixty-seven)$',
            'year': '^2000$',
            'port': '^(port.?.?)?67$',
            'level': '^(level.?.?)?67$',
            'caseInsensitive': '^TEXT$',
            'contains': '^.*TEXT.*$'
        };
        regexInput.value = placeholders[template] || '';
        regexInput.placeholder = 'Enter answer first, then re-select template';
        return;
    }
    
    // Build pattern based on template and answer
    const escapedAnswer = escapeRegex(answer);
    const wordForm = numberToWord(answer);
    
    const patterns = {
        'number': `^${escapedAnswer}$`,
        'numberOrWord': `^(${escapedAnswer}|${wordForm})$`,
        'year': `^${escapedAnswer}$`,
        'port': `^(port\\s*)?${escapedAnswer}$`,
        'level': `^(level\\s*)?${escapedAnswer}$`,
        'caseInsensitive': `^${escapedAnswer}$`,
        'contains': `.*${escapedAnswer}.*`
    };
    
    if (patterns[template]) {
        regexInput.value = patterns[template];
        regexInput.placeholder = 'e.g., ^(4|four)$';
    }
}

function numberToWord(num) {
    const words = {
        '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
        '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
        '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen',
        '14': 'fourteen', '15': 'fifteen', '16': 'sixteen', '17': 'seventeen',
        '18': 'eighteen', '19': 'nineteen', '20': 'twenty'
    };
    return words[num] || num;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==================== RESET ====================
function resetAll() {
    if (!confirm('Are you sure you want to reset all data? This will clear all questions, scores, and settings.')) {
        return;
    }
    
    localStorage.removeItem('triviaQuestState');
    localStorage.removeItem('sidebarCollapsedSections');
    
    state = {
        questions: [],
        usedQuestions: new Set(),
        currentQuestion: null,
        currentQuestionIndex: null,
        currentCustomPoints: null,
        currentDisplayedPoints: null,
        teams: [{ name: 'Team 1', score: 0 }],
        teamCount: 1,
        gameMode: 'single',
        questionOrder: 'ordered',
        nextQuestionId: 1,
        usePointValues: false,
        l1Points: 100,
        l2Points: 200,
        jeopardyRows: 5,
        maxAvailableRows: 5,
        pointLabel: '',
        pointImageUrl: 'logo.svg',
        pointImageMode: 'none',
        answerDifficulty: 'easy',
        feedbackIntensity: 'full',
        volume: 0.5,
        answerRevealed: false
    };
    
    // Reset UI
    elements.teamCount.value = '1';
    elements.usePointValues.checked = false;
    elements.l1Points.value = '100';
    elements.l2Points.value = '200';
    elements.jeopardyRows.value = '5';
    elements.pointLabel.value = '';
    elements.pointImageUrl.value = '';
    elements.pointImageMode.value = 'none';
    elements.answerDifficulty.value = 'easy';
    elements.feedbackIntensity.value = 'full';
    elements.volumeSlider.value = '50';
    if (elements.questionOrder) elements.questionOrder.value = 'ordered';
    updateVolumeUI();
    elements.imagePreviewGroup.classList.add('hidden');
    
    updateTeamInputs();
    updateScoreboard();
    updateQuestionCounter();
    setGameMode('single');
    
    elements.questionText.textContent = 'Press "Next Question" to start!';
    elements.answersGrid.innerHTML = '';
    elements.skipQuestionBtn.disabled = true;
    
    alert('All data has been reset!');
}

function resetScores() {
    if (!confirm('Reset all team scores to 0?')) {
        return;
    }
    
    for (let i = 0; i < state.teams.length; i++) {
        state.teams[i].score = 0;
    }
    
    updateScoreboard();
    saveState();
}

function resetQuestions() {
    if (!confirm('Reset all questions to unanswered? (Keeps scores and questions)')) {
        return;
    }
    
    state.usedQuestions.clear();
    state.currentQuestion = null;
    state.currentQuestionIndex = null;
    state.answerRevealed = false;
    
    // Reset UI
    elements.questionText.textContent = 'Press "Next Question" to start!';
    elements.answersGrid.innerHTML = '';
    elements.skipQuestionBtn.disabled = true;
    
    // Hide award sections
    if (elements.singleAwardSection) elements.singleAwardSection.classList.add('hidden');
    if (elements.questionActions) elements.questionActions.classList.remove('hidden');
    
    updateQuestionCounter();
    if (state.gameMode === 'jeopardy') {
        buildJeopardyBoard();
    }
    saveState();
    
    alert('All questions reset to unanswered!');
}

// ==================== GAME MODE ====================
function setGameMode(mode) {
    state.gameMode = mode;
    
    if (mode === 'single') {
        elements.singleMode.classList.remove('hidden');
        elements.jeopardyMode.classList.add('hidden');
        elements.singleModeBtn.classList.add('active');
        elements.jeopardyModeBtn.classList.remove('active');
    } else {
        elements.singleMode.classList.add('hidden');
        elements.jeopardyMode.classList.remove('hidden');
        elements.singleModeBtn.classList.remove('active');
        elements.jeopardyModeBtn.classList.add('active');
        buildJeopardyBoard();
    }
    
    saveState();
}

// ==================== SIDEBAR ====================
function toggleSidebar() {
    elements.sidebar.classList.toggle('open');
    elements.sidebarToggle.classList.toggle('active');
}

// Accordion toggle for control sections
function initAccordion() {
    const sections = document.querySelectorAll('.control-section[data-section]');
    
    // Load collapsed state from localStorage
    const savedState = localStorage.getItem('sidebarCollapsedSections');
    const collapsedSections = savedState ? JSON.parse(savedState) : ['points'];
    
    sections.forEach(section => {
        const sectionId = section.dataset.section;
        const header = section.querySelector('h3');
        
        // Apply saved collapsed state
        if (collapsedSections.includes(sectionId)) {
            section.classList.add('collapsed');
        }
        
        // Add click handler to toggle
        if (header) {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                section.classList.toggle('collapsed');
                saveAccordionState();
            });
        }
    });
}

function saveAccordionState() {
    const sections = document.querySelectorAll('.control-section[data-section]');
    const collapsedSections = [];
    
    sections.forEach(section => {
        if (section.classList.contains('collapsed')) {
            collapsedSections.push(section.dataset.section);
        }
    });
    
    localStorage.setItem('sidebarCollapsedSections', JSON.stringify(collapsedSections));
}

// ==================== ADD QUESTION MODAL ====================
function openAddQuestionModal() {
    const modal = document.getElementById('addQuestionModal');
    modal.classList.remove('hidden');
    document.getElementById('newCategory').focus();
}

function closeAddQuestionModal() {
    const modal = document.getElementById('addQuestionModal');
    modal.classList.add('hidden');
    elements.addQuestionForm.reset();
    // Reset to single add form
    if (elements.singleAddForm) elements.singleAddForm.classList.remove('hidden');
    if (elements.bulkAddForm) elements.bulkAddForm.classList.add('hidden');
}

// ==================== BULK ADD QUESTIONS ====================
function toggleBulkAddMode() {
    const singleForm = elements.singleAddForm;
    const bulkForm = elements.bulkAddForm;
    const bulkBtn = elements.bulkAddBtn;
    
    if (!singleForm || !bulkForm) return;
    
    const isBulkMode = !bulkForm.classList.contains('hidden');
    
    if (isBulkMode) {
        // Switch to single mode
        singleForm.classList.remove('hidden');
        bulkForm.classList.add('hidden');
        bulkBtn.textContent = '📋 Bulk Add';
    } else {
        // Switch to bulk mode
        singleForm.classList.add('hidden');
        bulkForm.classList.remove('hidden');
        bulkBtn.textContent = '✏️ Single Add';
        // Initialize with 3 rows if empty
        if (elements.bulkAddRows.children.length === 0) {
            for (let i = 0; i < 3; i++) {
                addBulkRow();
            }
        }
    }
}

function addBulkRow() {
    const container = elements.bulkAddRows;
    if (!container) return;
    
    const rowCount = container.children.length;
    if (rowCount >= 10) {
        alert('Maximum 10 questions at a time');
        return;
    }
    
    const row = document.createElement('div');
    row.className = 'bulk-row';
    row.innerHTML = `
        <span class="bulk-row-number">${rowCount + 1}</span>
        <input type="text" class="bulk-category" placeholder="Category" required>
        <select class="bulk-difficulty">
            <option value="L1">L1</option>
            <option value="L2">L2</option>
        </select>
        <select class="bulk-type">
            <option value="general">General</option>
            <option value="multiple_choice" selected>MC</option>
            <option value="multiple_answer">MA</option>
            <option value="hidden">Hidden</option>
        </select>
        <input type="text" class="bulk-question" placeholder="Question text" required>
        <input type="text" class="bulk-answers" placeholder="Correct answer(s), comma-sep">
        <input type="text" class="bulk-incorrect" placeholder="Incorrect answers, comma-sep">
        <button type="button" class="btn btn-small btn-danger bulk-remove-btn" title="Remove row">✕</button>
    `;
    
    // Add remove handler
    row.querySelector('.bulk-remove-btn').addEventListener('click', () => {
        row.remove();
        updateBulkRowNumbers();
    });
    
    container.appendChild(row);
}

function updateBulkRowNumbers() {
    const rows = elements.bulkAddRows.querySelectorAll('.bulk-row');
    rows.forEach((row, index) => {
        row.querySelector('.bulk-row-number').textContent = index + 1;
    });
}

function submitBulkQuestions() {
    const rows = elements.bulkAddRows.querySelectorAll('.bulk-row');
    const questions = [];
    const errors = [];
    
    rows.forEach((row, index) => {
        const category = row.querySelector('.bulk-category').value.trim();
        const difficulty = row.querySelector('.bulk-difficulty').value;
        const type = row.querySelector('.bulk-type').value;
        const question = row.querySelector('.bulk-question').value.trim();
        const answers = row.querySelector('.bulk-answers').value.split(',').map(a => a.trim()).filter(a => a);
        const incorrect = row.querySelector('.bulk-incorrect').value.split(',').map(a => a.trim()).filter(a => a);
        
        // Validate row
        if (!category || !question) {
            if (category || question || answers.length > 0) {
                errors.push(`Row ${index + 1}: Category and Question are required`);
            }
            return; // Skip empty rows
        }
        
        if (answers.length === 0) {
            errors.push(`Row ${index + 1}: At least one correct answer required`);
            return;
        }
        
        if ((type === 'multiple_choice' || type === 'multiple_answer') && incorrect.length < 3) {
            errors.push(`Row ${index + 1}: Multiple choice/answer needs at least 3 incorrect answers`);
            return;
        }
        
        // Normalize category to match existing
        let normalizedCategory = category;
        const existingCategory = state.questions.find(q => 
            q.Category.toLowerCase() === category.toLowerCase()
        );
        if (existingCategory) {
            normalizedCategory = existingCategory.Category;
        }
        
        const newQ = {
            QuestionId: state.nextQuestionId++,
            Category: normalizedCategory,
            Difficulty: difficulty,
            Type: type,
            Question: question,
            Answers: answers,
            IncorrectAnswers: incorrect,
            Description: '',
            RegEx: '',
            RegExDescription: ''
        };
        newQ.id = generateQuestionId(newQ);
        questions.push(newQ);
    });
    
    if (errors.length > 0) {
        alert('Errors:\n' + errors.join('\n'));
        return;
    }
    
    if (questions.length === 0) {
        alert('No valid questions to add');
        return;
    }
    
    // Add all questions
    state.questions.push(...questions);
    
    // Update UI
    recalculateMaxRows();
    updateQuestionCounter();
    if (state.gameMode === 'jeopardy') {
        buildJeopardyBoard();
    }
    saveState();
    
    // Clear and close
    elements.bulkAddRows.innerHTML = '';
    closeAddQuestionModal();
    alert(`Added ${questions.length} questions!`);
}

// Update image preview in settings
function updateImagePreview() {
    if (state.pointImageUrl && state.pointImageMode !== 'none') {
        elements.imagePreviewGroup.classList.remove('hidden');
        elements.pointImagePreview.src = state.pointImageUrl;
    } else {
        elements.imagePreviewGroup.classList.add('hidden');
    }
}

// ==================== EVENT LISTENERS ====================
function initEventListeners() {
    // Sidebar
    elements.sidebarToggle.addEventListener('click', toggleSidebar);
    
    // Game mode
    elements.singleModeBtn.addEventListener('click', () => setGameMode('single'));
    elements.jeopardyModeBtn.addEventListener('click', () => setGameMode('jeopardy'));
    
    // Team count
    elements.teamCount.addEventListener('change', (e) => {
        state.teamCount = parseInt(e.target.value);
        
        // Ensure we have enough team objects
        while (state.teams.length < state.teamCount) {
            state.teams.push({ name: `Team ${state.teams.length + 1}`, score: 0 });
        }
        
        updateTeamInputs();
        updateScoreboard();
        saveState();
    });
    
    // Points settings
    elements.usePointValues.addEventListener('change', (e) => {
        state.usePointValues = e.target.checked;
        elements.pointSettings.style.display = e.target.checked ? 'block' : 'none';
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    elements.l1Points.addEventListener('change', (e) => {
        state.l1Points = parseInt(e.target.value) || 100;
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    elements.l2Points.addEventListener('change', (e) => {
        state.l2Points = parseInt(e.target.value) || 200;
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    // Effects
    elements.feedbackIntensity.addEventListener('change', (e) => {
        state.feedbackIntensity = e.target.value;
        saveState();
    });
    
    // Volume slider
    elements.volumeSlider.addEventListener('input', (e) => {
        const volume = parseInt(e.target.value) / 100;
        state.volume = volume;
        updateVolumeUI();
        saveState();
    });
    
    // Answer difficulty
    elements.answerDifficulty.addEventListener('change', (e) => {
        state.answerDifficulty = e.target.value;
        saveState();
    });
    
    // Question order (ordered vs randomized)
    if (elements.questionOrder) {
        elements.questionOrder.addEventListener('change', (e) => {
            state.questionOrder = e.target.value;
            if (state.gameMode === 'jeopardy') {
                buildJeopardyBoard();
            }
            saveState();
        });
    }
    
    // Jeopardy rows
    elements.jeopardyRows.addEventListener('change', (e) => {
        let val = parseInt(e.target.value) || 5;
        val = Math.max(1, Math.min(val, state.maxAvailableRows || 10));
        state.jeopardyRows = val;
        e.target.value = val;
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    // Point label customization
    elements.pointLabel.addEventListener('input', (e) => {
        state.pointLabel = e.target.value.slice(0, 3);
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    // Point image URL
    elements.pointImageUrl.addEventListener('input', (e) => {
        state.pointImageUrl = e.target.value.trim();
        updateImagePreview();
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    // Point image mode
    elements.pointImageMode.addEventListener('change', (e) => {
        state.pointImageMode = e.target.value;
        updateImagePreview();
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    // Question management
    elements.loadSampleBtn.addEventListener('click', loadSampleQuestions);
    
    // Server Categories Modal
    elements.browseServerBtn.addEventListener('click', openCategoriesModal);
    elements.closeCategoriesBtn.addEventListener('click', closeCategoriesModal);
    elements.retryLoadCategories.addEventListener('click', loadServerCategories);
    elements.categoriesModal.addEventListener('click', (e) => {
        if (e.target === elements.categoriesModal) {
            closeCategoriesModal();
        }
    });
    
    elements.importBtn.addEventListener('click', () => {
        elements.importFile.click();
    });
    
    elements.importFile.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            importFromFile(e.target.files[0]);
            e.target.value = '';
        }
    });
    
    elements.exportBtn.addEventListener('click', exportToJSONL);
    
    // Add Question Modal
    elements.openAddQuestionBtn.addEventListener('click', openAddQuestionModal);
    elements.closeAddQuestionBtn.addEventListener('click', closeAddQuestionModal);
    elements.addQuestionModal.addEventListener('click', (e) => {
        if (e.target === elements.addQuestionModal) {
            closeAddQuestionModal();
        }
    });
    
    elements.addQuestionForm.addEventListener('submit', addQuestion);
    
    // Bulk add mode toggle
    if (elements.bulkAddBtn) {
        elements.bulkAddBtn.addEventListener('click', toggleBulkAddMode);
    }
    if (elements.addBulkRowBtn) {
        elements.addBulkRowBtn.addEventListener('click', addBulkRow);
    }
    if (elements.submitBulkBtn) {
        elements.submitBulkBtn.addEventListener('click', submitBulkQuestions);
    }
    
    // Add Question form - type change handler
    if (elements.newType) {
        elements.newType.addEventListener('change', handleQuestionTypeChange);
    }
    
    // Add Question form - regex template handler
    if (elements.regexTemplate) {
        elements.regexTemplate.addEventListener('change', handleRegexTemplateChange);
    }
    
    // Add Question form - auto-update regex when answer changes (if template selected)
    const newAnswersInput = document.getElementById('newAnswers');
    if (newAnswersInput && elements.regexTemplate) {
        newAnswersInput.addEventListener('input', () => {
            // Only auto-update if a template is selected (not custom)
            if (elements.regexTemplate.value) {
                handleRegexTemplateChange({ target: elements.regexTemplate });
            }
        });
    }
    
    elements.resetBtn.addEventListener('click', resetAll);
    elements.resetScoresBtn.addEventListener('click', resetScores);
    if (elements.resetQuestionsBtn) {
        elements.resetQuestionsBtn.addEventListener('click', resetQuestions);
    }
    
    // Single mode controls
    elements.nextQuestionBtn.addEventListener('click', nextQuestion);
    elements.skipQuestionBtn.addEventListener('click', skipQuestion);
    
    // Modal
    elements.closeModalBtn.addEventListener('click', closeModal);
    elements.questionModal.addEventListener('click', (e) => {
        // Only close if clicking overlay and answer not revealed (before answering)
        if (e.target === elements.questionModal && !state.answerRevealed) {
            closeModal();
        }
    });
    
    // Skip/No Points buttons (all three locations)
    elements.noPointsBtn.addEventListener('click', skipAward);
    if (elements.singleNoPointsBtn) {
        elements.singleNoPointsBtn.addEventListener('click', skipAward);
    }
    if (elements.modalNoPointsBtn) {
        elements.modalNoPointsBtn.addEventListener('click', skipAward);
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape key - close modal or sidebar
        if (e.key === 'Escape') {
            if (!elements.addQuestionModal.classList.contains('hidden')) {
                closeAddQuestionModal();
                return;
            }
            if (!elements.questionModal.classList.contains('hidden')) {
                closeModal();
            }
            if (elements.sidebar.classList.contains('open')) {
                toggleSidebar();
            }
            return;
        }
        
        // Don't handle keyboard shortcuts when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }
        
        // Number keys 1-8 to select answers
        const answerKeys = ['1', '2', '3', '4', '5', '6', '7', '8'];
        if (answerKeys.includes(e.key) && !state.answerRevealed) {
            const answerIndex = parseInt(e.key) - 1;
            const isModalOpen = !elements.questionModal.classList.contains('hidden');
            const answersContainer = isModalOpen ? elements.modalAnswersGrid : elements.answersGrid;
            const answerBtns = answersContainer.querySelectorAll('.answer-btn');
            
            if (answerBtns[answerIndex]) {
                answerBtns[answerIndex].click();
                answerBtns[answerIndex].focus();
            }
            return;
        }
        
        // Enter key - submit multi-select or start next question (only if not awaiting award)
        if (e.key === 'Enter') {
            // Check for multi-select submit button
            const isModalOpen = !elements.questionModal.classList.contains('hidden');
            const answersContainer = isModalOpen ? elements.modalAnswersGrid : elements.answersGrid;
            const submitBtn = answersContainer.querySelector('.submit-answers-btn:not(:disabled)');
            
            if (submitBtn) {
                submitBtn.click();
                return;
            }
            
            // Block proceeding if answer revealed (must use award/skip buttons)
            if (state.answerRevealed) {
                // Don't allow Enter to bypass the award flow
                return;
            }
            
            // If no question displayed, start next question (single mode only)
            if (!state.currentQuestion && state.gameMode === 'single') {
                nextQuestion();
                return;
            }
        }
        
        // Space key - toggle selection for focused answer (multi-select)
        if (e.key === ' ' && e.target.classList.contains('answer-btn')) {
            e.preventDefault();
            e.target.click();
        }
    });
}



// ==================== INITIALIZATION ====================
function init() {
    const hasState = loadState();
    
    // Handle migration from old muted boolean to volume
    if (state.muted !== undefined) {
        state.volume = state.muted ? 0 : 0.5;
        delete state.muted;
        saveState();
    }
    
    if (hasState) {
        // Restore UI from state
        elements.teamCount.value = state.teamCount.toString();
        elements.usePointValues.checked = state.usePointValues;
        elements.pointSettings.style.display = state.usePointValues ? 'block' : 'none';
        elements.l1Points.value = state.l1Points;
        elements.l2Points.value = state.l2Points;
        elements.feedbackIntensity.value = state.feedbackIntensity;
        
        // Restore volume
        if (state.volume !== undefined) {
            updateVolumeUI();
        }
        
        if (elements.jeopardyRows) {
            elements.jeopardyRows.value = state.jeopardyRows || 5;
        }
        if (elements.answerDifficulty) {
            elements.answerDifficulty.value = state.answerDifficulty || 'easy';
        }
        if (elements.pointLabel) {
            elements.pointLabel.value = state.pointLabel || '';
        }
        if (elements.pointImageUrl) {
            elements.pointImageUrl.value = state.pointImageUrl || '';
        }
        if (elements.pointImageMode) {
            elements.pointImageMode.value = state.pointImageMode || 'none';
        }
        if (elements.questionOrder) {
            elements.questionOrder.value = state.questionOrder || 'ordered';
        }
        updateImagePreview();
    } else {
        // Initialize volume UI for new sessions
        updateVolumeUI();
    }
    
    initEventListeners();
    initAccordion();
    updateTeamInputs();
    updateScoreboard();
    updateQuestionCounter();
    setGameMode(state.gameMode);
    
    // Register service worker for offline support
    registerServiceWorker();
}

// Register service worker for offline PWA support
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(registration => {
                console.log('Service Worker registered:', registration.scope);
            })
            .catch(error => {
                console.log('Service Worker registration failed:', error);
            });
    }
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
